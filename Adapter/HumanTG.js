/**
* This file is part of the Bncr project.
* @author Aming
* @name HumanTG
* @team Bncr团队
* @version 1.0.7
* @description Telegram 人行适配器（优化 message_id_invalid 处理）
* @adapter true
* @public true
* @priority 101
* @classification ["官方适配器"]
* Unauthorized copying of this file, via any medium is strictly prohibited.
*/

const jsonSchema = BncrCreateSchema.object({
  enable: BncrCreateSchema.boolean()
    .setTitle('是否开启适配器')
    .setDescription('设置为关则不加载该适配器')
    .setDefault(false),
  apiId: BncrCreateSchema.number().setTitle('apiID').setDescription('Telegram apiID').setDefault(0),
  apiHash: BncrCreateSchema.string().setTitle('apiHash').setDescription('Telegram apiHash').setDefault(''),
  startLogOutChat: BncrCreateSchema.string().setTitle('启动日志输出位置').setDefault(''),
  connectionRetries: BncrCreateSchema.number().setTitle('链接超时重试次数').setDefault(10),
  proxyEnable: BncrCreateSchema.boolean().setTitle('Telegram代理开关').setDefault(false),
  proxy: BncrCreateSchema.object({
    host: BncrCreateSchema.string().setTitle('主机地址').setDefault(''),
    port: BncrCreateSchema.number().setTitle('端口号').setDefault(0),
    socksType: BncrCreateSchema.number().setTitle('版本类型').setDefault(5),
    timeout: BncrCreateSchema.number().setTitle('链接超时').setDefault(5),
    username: BncrCreateSchema.string().setTitle('账户').setDefault(''),
    password: BncrCreateSchema.string().setTitle('密码').setDefault('')
  }).setTitle('代理配置')
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

module.exports = () => {
  return new Promise(async (resolve, reject) => {
    await ConfigDB.get();
    if (!Object.keys(ConfigDB.userConfig).length) {
      reject('未配置适配器,退出.');
      return;
    }
    if (!ConfigDB.userConfig.enable) {
      reject('未启用HumanTG,退出.');
      return;
    }

    /** 登录超时保护 **/
    const timeoutID = setTimeout(() => reject('HumanTG登录超时,放弃加载该适配器'), 2 * 60 * 1000);

    await sysMethod.testModule(['telegram', 'input', 'markdown-it'], { install: true });
    const md = require('markdown-it')({ html: true });
    md.renderer.rules.paragraph_open = () => '';
    md.renderer.rules.paragraph_close = () => '';

    const HumanTG = new Adapter('HumanTG');
    const { StringSession } = require('telegram/sessions');
    const { Api, TelegramClient } = require('telegram');
    const { NewMessage } = require('telegram/events');
    const input = require('input');
    const HumanTgDb = new BncrDB('HumanTG');
    const session = await HumanTgDb.get('session', '');
    const apiId = ConfigDB.userConfig.apiId;
    const apiHash = ConfigDB.userConfig.apiHash;
    const stringSession = new StringSession(session);

    const loginOpt = {
      connectionRetries: 100,
      useWSS: false,
      timeout: 5,
      autoReconnect: true,
      floodSleepThreshold: 20,
      deviceModel: 'Bncr',
      appVersion: sysMethod.Version
    };

    if (ConfigDB.userConfig.proxyEnable) {
      sysMethod.startOutLogs('使用socks5登录HumanTG...');
      loginOpt.proxy = { ...ConfigDB.userConfig.proxy, ip: ConfigDB.userConfig.proxy.host };
    }

    const client = new TelegramClient(stringSession, apiId, apiHash, loginOpt);
    await client.start({
      phoneNumber: async () => await input.text('输入注册TG手机号(带+86): '),
      password: async () => await input.text('输入密码: '),
      phoneCode: async () => await input.text('输入TG收到的验证码: '),
      onError: err => console.log(err)
    });

    const newSession = client.session.save();
    if (newSession !== session) await HumanTgDb.set('session', newSession);
    sysMethod.startOutLogs('HumanTG登录成功...');
    clearTimeout(timeoutID);

    const loginUserInfo = await client.getMe();
    HumanTG.Bridge = {};

    // 监听消息
    client.addEventHandler(async event => {
      if (!event.message.text) return;
      const message = event.message;
      const senderInfo = await message.getSender();
      const msgInfo = {
        userId: senderInfo?.id?.toString() || '',
        friendId: message?.peerId?.userId?.toString() || '',
        userName: senderInfo?.username || senderInfo?.firstName || '',
        groupId: event.isPrivate ? '0' : message?.chatId?.toString() || '0',
        groupName: event.isPrivate ? '' : message?.chat?.title || '',
        msg: message.text || '',
        msgId: `${message?.id}` || '',
        replyToMsgId: `${message?.replyTo?.replyToMsgId}` || '0'
      };
      HumanTG.receive(msgInfo);
    }, new NewMessage());

    /** 修正版 reply **/
    HumanTG.reply = async function (replyInfo) {
      try {
        let sendRes = null;
        const sendID = +replyInfo.groupId || +replyInfo.userId;

        // 安全发送函数
        const safeSend = async (opts) => {
          try {
            return await client.sendMessage(sendID, opts);
          } catch (e) {
            console.error('HumanTG安全发送失败:', e);
            return null;
          }
        };

        if (replyInfo.type === 'text') {
          if (!replyInfo.dontEdit && replyInfo.userId === loginUserInfo.id.toString()) {
            try {
              sendRes = await client.editMessage(sendID, {
                message: +replyInfo.toMsgId,
                text: replyInfo.msg
              });
            } catch (e) {
              if (e.errorMessage && e.errorMessage.includes('MESSAGE_ID_INVALID')) {
                // 捕获并改为发送新消息
                sendRes = await safeSend({ message: replyInfo.msg, parseMode: 'md' });
              } else {
                console.error('HumanTG编辑消息失败:', e.errorMessage || e);
              }
            }
          } else {
            sendRes = await safeSend({ message: replyInfo.msg, parseMode: 'md' });
          }
        } else if (replyInfo.type === 'image') {
          sendRes = await safeSend({ message: replyInfo.msg || '', file: replyInfo.path, forceDocument: false });
        } else if (replyInfo.type === 'video') {
          sendRes = await safeSend({ message: replyInfo.msg || '', file: replyInfo.path });
        } else if (replyInfo.type === 'audio') {
          sendRes = await safeSend({
            file: replyInfo.path,
            attributes: [new Api.DocumentAttributeAudio({
              title: replyInfo.name || '',
              performer: replyInfo.singer || ''
            })]
          });
        } else if (replyInfo.type === 'markdown') {
          sendRes = await safeSend({ message: md.render(replyInfo.msg), parseMode: 'html' });
        } else if (replyInfo.type === 'html') {
          sendRes = await safeSend({ message: replyInfo.msg, parseMode: 'html' });
        }

        return (sendRes && `${sendRes.id}`) || '';
      } catch (e) {
        console.error('HumanTG发送消息失败', e);
        return '';
      }
    };

    HumanTG.push = async function (replyInfo) {
      return this.reply(replyInfo);
    };

    resolve(HumanTG);
  });
};
