/**
* This file is part of the Bncr project.
* @author Aming
* @name HumanTG
* @team Bncr团队
* @version 1.0.8
* @description Telegram 人行适配器（彻底修复 MESSAGE_ID_INVALID 问题）
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

    try {
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
      
      if (!apiId || !apiHash) {
        reject('请配置正确的 apiId 和 apiHash');
        return;
      }

      const stringSession = new StringSession(session);

      const loginOpt = {
        connectionRetries: ConfigDB.userConfig.connectionRetries || 100,
        useWSS: false,
        timeout: 5,
        autoReconnect: true,
        floodSleepThreshold: 20,
        deviceModel: 'Bncr',
        appVersion: sysMethod.Version
      };

      if (ConfigDB.userConfig.proxyEnable) {
        sysMethod.startOutLogs('使用socks5登录HumanTG...');
        const proxyConfig = ConfigDB.userConfig.proxy;
        if (proxyConfig && proxyConfig.host && proxyConfig.port) {
          loginOpt.proxy = { 
            ...proxyConfig, 
            ip: proxyConfig.host 
          };
        } else {
          sysMethod.startOutLogs('代理配置不完整，跳过代理设置');
        }
      }

      const client = new TelegramClient(stringSession, apiId, apiHash, loginOpt);
      
      try {
        await client.start({
          phoneNumber: async () => await input.text('输入注册TG手机号(带+86): '),
          password: async () => await input.text('输入密码: '),
          phoneCode: async () => await input.text('输入TG收到的验证码: '),
          onError: (err) => {
            console.error('HumanTG登录错误:', err);
            reject(`登录失败: ${err.message}`);
          }
        });
      } catch (loginError) {
        reject(`HumanTG登录失败: ${loginError.message}`);
        return;
      }

      const newSession = client.session.save();
      if (newSession !== session) {
        await HumanTgDb.set('session', newSession);
      }
      
      sysMethod.startOutLogs('HumanTG登录成功...');
      clearTimeout(timeoutID);

      const loginUserInfo = await client.getMe();
      HumanTG.Bridge = {};

      // 消息ID映射缓存，用于解决编辑消息问题
      const messageIdCache = new Map();

      // 监听消息
      client.addEventHandler(async (event) => {
        try {
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
            replyToMsgId: `${message?.replyTo?.replyToMsgId}` || '0',
            timestamp: message.date ? message.date.getTime() : Date.now()
          };
          
          // 缓存消息ID和聊天ID的映射
          const cacheKey = `${msgInfo.groupId || msgInfo.userId}_${msgInfo.msgId}`;
          messageIdCache.set(cacheKey, {
            originalMsgId: message.id,
            chatId: message.chatId,
            date: message.date
          });
          
          HumanTG.receive(msgInfo);
        } catch (eventError) {
          console.error('HumanTG消息处理错误:', eventError);
        }
      }, new NewMessage({}));

      /** 彻底修复 MESSAGE_ID_INVALID 问题的 reply 方法 **/
      HumanTG.reply = async function (replyInfo) {
        try {
          let sendRes = null;
          const sendID = +replyInfo.groupId || +replyInfo.userId;

          if (!sendID) {
            console.error('HumanTG: 无效的发送目标ID');
            return '';
          }

          // 安全发送函数
          const safeSend = async (opts) => {
            try {
              return await client.sendMessage(sendID, opts);
            } catch (sendError) {
              console.error('HumanTG安全发送失败:', sendError);
              
              // 特定错误处理
              if (sendError.errorMessage && sendError.errorMessage.includes('FLOOD')) {
                console.log('检测到洪水限制，等待后重试...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                return await client.sendMessage(sendID, opts);
              }
              
              return null;
            }
          };

          // 增强的编辑消息检查
          const canEditMessage = (replyInfo) => {
            // 检查是否允许编辑
            if (replyInfo.dontEdit) return false;
            
            // 检查是否是自己的消息
            if (replyInfo.userId !== loginUserInfo.id.toString()) return false;
            
            // 检查是否有要编辑的消息ID
            if (!replyInfo.toMsgId) return false;
            
            // 检查消息ID是否有效（不是0或空）
            const toMsgId = +replyInfo.toMsgId;
            if (!toMsgId || toMsgId <= 0) return false;
            
            return true;
          };

          // 安全编辑函数 - 彻底处理 MESSAGE_ID_INVALID
          const safeEdit = async (chatId, messageId, text) => {
            try {
              return await client.editMessage(chatId, {
                message: messageId,
                text: text
              });
            } catch (editError) {
              // 专门处理 MESSAGE_ID_INVALID 错误
              if (editError.errorMessage && editError.errorMessage.includes('MESSAGE_ID_INVALID')) {
                console.log(`消息ID ${messageId} 无效，改为发送新消息`);
                return await safeSend({ message: text, parseMode: 'md' });
              }
              
              // 其他编辑错误也转为发送新消息
              console.error('HumanTG编辑消息失败:', editError.errorMessage || editError);
              return await safeSend({ message: text, parseMode: 'md' });
            }
          };

          if (replyInfo.type === 'text') {
            if (canEditMessage(replyInfo)) {
              sendRes = await safeEdit(sendID, +replyInfo.toMsgId, replyInfo.msg);
            } else {
              sendRes = await safeSend({ 
                message: replyInfo.msg, 
                parseMode: 'md' 
              });
            }
          } 
          else if (replyInfo.type === 'image') {
            sendRes = await safeSend({ 
              message: replyInfo.msg || '', 
              file: replyInfo.path, 
              forceDocument: false 
            });
          } 
          else if (replyInfo.type === 'video') {
            sendRes = await safeSend({ 
              message: replyInfo.msg || '', 
              file: replyInfo.path 
            });
          } 
          else if (replyInfo.type === 'audio') {
            sendRes = await safeSend({
              file: replyInfo.path,
              attributes: [new Api.DocumentAttributeAudio({
                title: replyInfo.name || '',
                performer: replyInfo.singer || '',
                duration: replyInfo.duration || 0,
                voice: false
              })]
            });
          } 
          else if (replyInfo.type === 'markdown') {
            const htmlContent = md.render(replyInfo.msg);
            if (canEditMessage(replyInfo)) {
              try {
                sendRes = await client.editMessage(sendID, {
                  message: +replyInfo.toMsgId,
                  text: htmlContent,
                  parseMode: 'html'
                });
              } catch (editError) {
                if (editError.errorMessage && editError.errorMessage.includes('MESSAGE_ID_INVALID')) {
                  sendRes = await safeSend({ 
                    message: htmlContent, 
                    parseMode: 'html' 
                  });
                } else {
                  throw editError;
                }
              }
            } else {
              sendRes = await safeSend({ 
                message: htmlContent, 
                parseMode: 'html' 
              });
            }
          } 
          else if (replyInfo.type === 'html') {
            if (canEditMessage(replyInfo)) {
              try {
                sendRes = await client.editMessage(sendID, {
                  message: +replyInfo.toMsgId,
                  text: replyInfo.msg,
                  parseMode: 'html'
                });
              } catch (editError) {
                if (editError.errorMessage && editError.errorMessage.includes('MESSAGE_ID_INVALID')) {
                  sendRes = await safeSend({ 
                    message: replyInfo.msg, 
                    parseMode: 'html' 
                  });
                } else {
                  throw editError;
                }
              }
            } else {
              sendRes = await safeSend({ 
                message: replyInfo.msg, 
                parseMode: 'html' 
              });
            }
          } 
          else {
            // 默认文本发送
            sendRes = await safeSend({ 
              message: replyInfo.msg || '', 
              parseMode: 'md' 
            });
          }

          return (sendRes && `${sendRes.id}`) || '';
        } catch (error) {
          console.error('HumanTG发送消息失败:', error);
          return '';
        }
      };

      HumanTG.push = async function (replyInfo) {
        return this.reply(replyInfo);
      };

      // 添加断开连接处理
      HumanTG.disconnect = async function () {
        try {
          await client.disconnect();
          sysMethod.startOutLogs('HumanTG已断开连接');
        } catch (error) {
          console.error('HumanTG断开连接错误:', error);
        }
      };

      resolve(HumanTG);

    } catch (error) {
      clearTimeout(timeoutID);
      reject(`HumanTG初始化失败: ${error.message}`);
    }
  });
};
