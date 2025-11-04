/**
 * This file is part of the Bncr project.
 * @author Anmour
 * @name wxXyo
 * @team Bncr团队
 * @version 1.0.3
 * @description wxXyo适配器（增强版：支持接收图片、视频、文件）
 * @adapter true
 * @public true
 * @disable false
 * @priority 2
 * @classification ["官方适配器"]
 * ©2023 Aming and Anmours. All rights reserved
 */

/* 配置构造器 */
const jsonSchema = BncrCreateSchema.object({
  enable: BncrCreateSchema.boolean()
    。setTitle('是否开启适配器')
    。setDescription('设置为关则不加载该适配器')
    。setDefault(false),
  sendUrl: BncrCreateSchema.string()
    。setTitle('上报地址')
    。setDescription('无界收到消息要发送到的url')
    。setDefault('')
});

/* 配置管理器 */
const ConfigDB = new BncrPluginConfig(jsonSchema);

module。exports = async () => {
  await ConfigDB.get();
  if (!Object.keys(ConfigDB.userConfig).length) {
    sysMethod.startOutLogs('未启用Xyo适配器,退出.');
    return;
  }
  if (!ConfigDB.userConfig.enable) return sysMethod.startOutLogs('未启用Xyo, 退出.');
  let XyoUrl = ConfigDB.userConfig.sendUrl;
  if (!XyoUrl) return console.log('Xyo:配置文件未设置 sendUrl');

  const wxXyo = new Adapter('wxXyo');
  const request = require('util').promisify(require('request'));
  const wxDB = new BncrDB('wxXyo');
  let botId = await wxDB.get('xyo_botid', '');
  let token = await wxDB.get('xyo_token', '');

  /** 路由接口 */
  router.get('/api/bot/Xyo', (req, res) =>
    res.send({ msg: '这是Bncr Xyo Api接口，你的get请求测试正常~，请用post交互数据' })
  );

  /* 接收消息核心 */
  router.post('/api/bot/Xyo', async (req, res) => {
    try {
      const body = req.body;
      if (body.content.from_wxid === body.content.robot_wxid)
        return res.send({ status: 400, data: '', msg: `拒收该消息:${body.msg}` });

      if (botId !== body.content.robot_wxid)
        botId = await wxDB.set('xyo_botid', body.content.robot_wxid, { def: body.content.robot_wxid });

      /**
       * 消息类型：
       * 1|文本 3|图片 34|语音 42|名片 43|视频 47|动态表情
       * 48|地理位置 49|分享链接或附件
       */
      const allowTypes = [1, 3, 43, 49];
      if (!allowTypes.includes(body.content.type)) {
        return res.send({ status: 400, data: '', msg: `忽略类型:${body.content.type}` });
      }

      let msgInfo = null;
      const baseInfo = {
        userId: body.content.from_wxid || '',
        userName: body.content.from_name || '',
        groupId: body.content.from_group ? body.content.from_group.replace('@chatroom', '') : '0',
        groupName: body.content.from_group_name || '',
        msgId: body.content.msg_id || '',
        fromType: 'Social',
        msgType: body.content.type,
      };

      // 各类型处理
      switch (body.content.type) {
        case 1: // 文本
          baseInfo.msg = body.content.msg || '';
          break;
        case 3: // 图片
          baseInfo.msg = '[图片]';
          baseInfo.fileUrl = body.content.msg || body.content.file_path || body.content.image_path || '';
          break;
        case 43: // 视频
          baseInfo.msg = '[视频]';
          baseInfo.fileUrl = body.content.msg || body.content.file_path || '';
          break;
        case 49: // 分享/附件
          baseInfo.msg = '[文件]';
          baseInfo.fileUrl = body.content.file_path || body.content.msg || '';
          break;
        default:
          baseInfo.msg = `[未处理的消息类型:${body.content.type}]`;
          break;
      }

      if (body.Event === 'EventPrivateChat') {
        msgInfo = { ...baseInfo };
      } else if (body.Event === 'EventGroupChat') {
        msgInfo = { ...baseInfo };
      }

      msgInfo && wxXyo.receive(msgInfo);
      res.send({ status: 200, data: '', msg: 'ok' });
    } catch (e) {
      console.error('wxXyo接收器错误:', e);
      res.send({ status: 400, data: '', msg: e.toString() });
    }
  });

  /* 发送回复 */
  wxXyo.reply = async function (replyInfo) {
    if (!token)
      throw new Error('xyo发送消息失败：未设置 xyo_token，使用 set wxXyo xyo_token xxx 设置');
    const to_Wxid = +replyInfo.groupId ? replyInfo.groupId + '@chatroom' : replyInfo.userId;
    let body = null;

    switch (replyInfo.type) {
      case 'text':
        replyInfo.msg = replyInfo.msg.replace(/\n/g, '\r');
        body = {
          to_wxid: to_Wxid,
          msg: replyInfo.msg,
          api: 'SendTextMsg'
        };
        break;
      case 'image':
        body = {
          to_wxid: to_Wxid,
          path: replyInfo.path,
          api: 'SendImageMsg'
        };
        break;
      case 'video':
        body = {
          to_wxid: to_Wxid,
          path: replyInfo.path,
          api: 'SendVideoMsg'
        };
        break;
      case 'file': // 附件
        body = {
          to_wxid: to_Wxid,
          path: replyInfo.path,
          api: 'SendFileMsg'
        };
        break;
      case 'audio':
        body = {
          to_wxid: to_Wxid,
          title: replyInfo?.name || '',
          desc: replyInfo?.singer || '',
          url: replyInfo?.path || '',
          dataurl: replyInfo?.path || '',
          thumburl: replyInfo?.img || '',
          api: 'SendMusicLinkMsg'
        };
        break;
      default:
        return;
    }

    body && await requestXyo(body);
    return '';
  };

  /* 推送消息使用 reply */
  wxXyo.push = async function (replyInfo) {
    return this.reply(replyInfo);
  };

  /* wx 无法撤回消息 */
  wxXyo.delMsg = () => { };

  /* 向 Xyo 服务端请求 */
  async function requestXyo(body) {
    return (
      await request({
        url: XyoUrl,
        method: 'post',
        body: {
          ...body,
          ...{ token, robot_wxid: botId }
        },
        json: true
      })
    ).body;
  }

  return wxXyo;
};
