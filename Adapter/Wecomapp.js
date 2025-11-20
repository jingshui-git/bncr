/**
 * This file is part of the App project.
 * @author jingshui
 * @name Wecomapp
 * @team jingshui
 * @version 1.0.1
 * @description 企业微信应用适配器 - 支持完整对话功能
 * @adapter true
 * @public false
 * @disable false
 * @priority 10000
 * @classification ["第三方适配器"]
 * @Copyright ©2025 Assistant. All rights reserved
 * @systemVersion >=3.0.0
 * @authentication true
 */

const jsonSchema = BncrCreateSchema.object({
  enable: BncrCreateSchema.boolean().setTitle('启用适配器').setDefault(true),
  debug: BncrCreateSchema.boolean().setTitle('调试模式').setDefault(false),
  
  // 企业微信应用配置
  corpId: BncrCreateSchema.string().setTitle('企业ID').setDescription('企业微信管理后台获取').setDefault(''),
  agentId: BncrCreateSchema.string().setTitle('应用ID').setDescription('企业微信应用AgentId').setDefault(''),
  secret: BncrCreateSchema.string().setTitle('应用密钥').setDescription('企业微信应用Secret').setDefault(''),
  
  // 消息接收配置
  receiveToken: BncrCreateSchema.string().setTitle('接收消息Token').setDescription('企业微信应用接收消息的Token').setDefault('BncrWecomAdapter'),
  receiveEncodingAESKey: BncrCreateSchema.string().setTitle('接收消息EncodingAESKey').setDescription('企业微信应用接收消息的EncodingAESKey').setDefault(''),
  listenPort: BncrCreateSchema.string().setTitle('监听端口').setDescription('接收消息的端口').setDefault('8898'),
  
  // 消息处理配置
  messageHandling: BncrCreateSchema.object({
    enableImageForward: BncrCreateSchema.boolean().setTitle('启用图片转发').setDefault(true),
    imageTemplate: BncrCreateSchema.string().setTitle('图片消息模板').setDefault('🖼️ [企业微信图片]'),
    enableEventForward: BncrCreateSchema.boolean().setTitle('启用事件转发').setDefault(false),
    autoReplyEnabled: BncrCreateSchema.boolean().setTitle('启用自动回复').setDefault(false)
  }).setTitle('消息处理配置').setDefault({})
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

// 企业微信API工具类
class WecomAPI {
  constructor(corpId, agentId, secret) {
    this.corpId = corpId;
    this.agentId = agentId;
    this.secret = secret;
    this.accessToken = '';
    this.tokenExpireTime = 0;
    this.debug = false;
  }
  
  setDebug(debug) {
    this.debug = debug;
  }
  
  log(message) {
    if (this.debug) {
      console.log(`[WecomAPI] ${message}`);
    }
  }
  
  async getAccessToken() {
    // 检查token是否过期
    if (this.accessToken && Date.now() < this.tokenExpireTime) {
      return this.accessToken;
    }
    
    try {
      const request = require('util').promisify(require('request'));
      const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${this.corpId}&corpsecret=${this.secret}`;
      
      this.log(`获取AccessToken: ${url}`);
      const response = await request({ 
        url, 
        method: 'GET', 
        json: true,
        timeout: 10000 
      });
      
      if (response.body && response.body.errcode === 0) {
        this.accessToken = response.body.access_token;
        this.tokenExpireTime = Date.now() + (response.body.expires_in - 60) * 1000;
        this.log(`获取AccessToken成功: ${this.accessToken.substring(0, 20)}...`);
        return this.accessToken;
      } else {
        const errMsg = response.body ? response.body.errmsg : '请求失败';
        throw new Error(`获取AccessToken失败: ${errMsg}`);
      }
    } catch (error) {
      console.error('WecomAPI获取AccessToken错误:', error);
      throw error;
    }
  }
  
  async sendTextMessage(toUser, content) {
    try {
      const token = await this.getAccessToken();
      const request = require('util').promisify(require('request'));
      
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
      const data = {
        touser: toUser || '',
        msgtype: 'text',
        agentid: this.agentId,
        text: {
          content: content
        }
      };
      
      this.log(`发送文本消息到: ${toUser}, 内容: ${content.substring(0, 50)}...`);
      
      const response = await request({
        url,
        method: 'POST',
        body: data,
        json: true,
        timeout: 10000
      });
      
      this.log(`发送消息响应: ${JSON.stringify(response.body)}`);
      return response.body;
    } catch (error) {
      console.error('WecomAPI发送文本消息错误:', error);
      throw error;
    }
  }
  
  async sendImageMessage(toUser, mediaId) {
    try {
      const token = await this.getAccessToken();
      const request = require('util').promisify(require('request'));
      
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`;
      const data = {
        touser: toUser || '',
        msgtype: 'image',
        agentid: this.agentId,
        image: {
          media_id: mediaId
        }
      };
      
      this.log(`发送图片消息到: ${toUser}, MediaId: ${mediaId}`);
      
      const response = await request({
        url,
        method: 'POST',
        body: data,
        json: true,
        timeout: 10000
      });
      
      return response.body;
    } catch (error) {
      console.error('WecomAPI发送图片消息错误:', error);
      throw error;
    }
  }
  
  async uploadMedia(type, filePath) {
    try {
      const token = await this.getAccessToken();
      const request = require('util').promisify(require('request'));
      const fs = require('fs');
      const path = require('path');
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }
      
      const url = `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=${type}`;
      
      const formData = {
        media: {
          value: fs.createReadStream(filePath),
          options: {
            filename: path.basename(filePath),
            contentType: 'application/octet-stream'
          }
        }
      };
      
      this.log(`上传媒体文件: ${filePath}, 类型: ${type}`);
      
      const response = await request({
        url,
        method: 'POST',
        formData: formData,
        timeout: 30000
      });
      
      const result = JSON.parse(response.body);
      this.log(`上传媒体结果: ${JSON.stringify(result)}`);
      return result;
    } catch (error) {
      console.error('WecomAPI上传媒体文件错误:', error);
      throw error;
    }
  }
}

// 企业微信消息处理器
class WecomMessageProcessor {
  constructor() {
    this.debug = false;
  }
  
  setDebug(debug) {
    this.debug = debug;
  }
  
  log(message) {
    if (this.debug) {
      console.log(`[WecomProcessor] ${message}`);
    }
  }
  
  // 解析接收到的企业微信消息
  parseWecomMessage(body) {
    try {
      this.log(`解析原始消息: ${JSON.stringify(body)}`);
      
      const message = {
        ToUserName: body.ToUserName,
        FromUserName: body.FromUserName,
        CreateTime: body.CreateTime,
        MsgType: body.MsgType,
        MsgId: body.MsgId,
        AgentID: body.AgentID
      };
      
      // 根据消息类型提取不同字段
      switch (body.MsgType) {
        case 'text':
          message.Content = body.Content;
          break;
        case 'image':
          message.PicUrl = body.PicUrl;
          message.MediaId = body.MediaId;
          break;
        case 'voice':
          message.MediaId = body.MediaId;
          message.Format = body.Format;
          break;
        case 'video':
          message.MediaId = body.MediaId;
          message.ThumbMediaId = body.ThumbMediaId;
          break;
        case 'location':
          message.Location_X = body.Location_X;
          message.Location_Y = body.Location_Y;
          message.Scale = body.Scale;
          message.Label = body.Label;
          break;
        case 'event':
          message.Event = body.Event;
          message.EventKey = body.EventKey;
          break;
      }
      
      this.log(`解析成功: ${body.MsgType} 消息`);
      return message;
    } catch (error) {
      console.error('解析企业微信消息错误:', error);
      return null;
    }
  }
  
  // 构建Bncr标准消息格式
  buildBncrMessage(wecomMsg, config) {
    const msgInfo = {
      userId: wecomMsg.FromUserName,
      userName: '',
      groupId: '0',
      groupName: '',
      msg: '',
      msgId: wecomMsg.MsgId,
      from: 'wecomapp',
      fromType: 'Social',
      timeStamp: wecomMsg.CreateTime ? wecomMsg.CreateTime * 1000 : Date.now(),
      _wecomAgentId: config.agentId,
      _wecomRawMessage: wecomMsg
    };
    
    // 根据消息类型处理内容
    switch (wecomMsg.MsgType) {
      case 'text':
        msgInfo.msg = wecomMsg.Content;
        break;
      case 'image':
        if (config.messageHandling.enableImageForward) {
          msgInfo.msg = `${config.messageHandling.imageTemplate}\nMediaId: ${wecomMsg.MediaId}`;
        } else {
          msgInfo.msg = '[图片消息]';
        }
        msgInfo._isImage = true;
        msgInfo._imageMediaId = wecomMsg.MediaId;
        msgInfo._imagePicUrl = wecomMsg.PicUrl;
        break;
      case 'voice':
        msgInfo.msg = '[语音消息]';
        msgInfo._isVoice = true;
        msgInfo._voiceMediaId = wecomMsg.MediaId;
        break;
      case 'video':
        msgInfo.msg = '[视频消息]';
        msgInfo._isVideo = true;
        msgInfo._videoMediaId = wecomMsg.MediaId;
        break;
      case 'event':
        if (config.messageHandling.enableEventForward) {
          msgInfo.msg = `[事件] ${wecomMsg.Event} ${wecomMsg.EventKey || ''}`;
        } else {
          return null; // 不转发事件消息
        }
        msgInfo._isEvent = true;
        msgInfo._eventType = wecomMsg.Event;
        break;
      default:
        msgInfo.msg = `[${wecomMsg.MsgType}消息]`;
        break;
    }
    
    this.log(`构建Bncr消息: ${msgInfo.msg}`);
    return msgInfo;
  }
}

module.exports = async () => {
  /* 读取用户配置 */
  await ConfigDB.get();
  
  /* 如果用户未配置或未启用,则退出 */
  if (!Object.keys(ConfigDB.userConfig).length || !ConfigDB.userConfig.enable) {
    sysMethod.startOutLogs('未启用企业微信适配器,退出.');
    return;
  }

  const config = ConfigDB.userConfig;
  const { corpId, agentId, secret, receiveToken, receiveEncodingAESKey, listenPort, debug } = config;
  
  if (!corpId || !agentId || !secret) {
    console.log('企业微信适配器: 缺少必要配置(corpId, agentId, secret)');
    return;
  }

  // 创建适配器实例
  const wecomapp = new Adapter('wecomapp');
  
  // 初始化API和处理器
  const wecomAPI = new WecomAPI(corpId, agentId, secret);
  const messageProcessor = new WecomMessageProcessor();
  
  wecomAPI.setDebug(debug);
  messageProcessor.setDebug(debug);
  
  /** 设置企业微信消息接收路由 */
  router.post('/api/bot/wecomapp', async (req, res) => {
    try {
      const body = req.body;
      messageProcessor.log(`收到企业微信回调: ${JSON.stringify(body)}`);
      
      // 解析企业微信消息
      const wecomMsg = messageProcessor.parseWecomMessage(body);
      if (!wecomMsg) {
        res.send('success');
        return;
      }
      
      // 构建Bncr标准消息格式
      const msgInfo = messageProcessor.buildBncrMessage(wecomMsg, config);
      if (!msgInfo) {
        res.send('success');
        return;
      }
      
      // 传递给适配器处理
      wecomapp.receive(msgInfo);
      
      // 企业微信要求返回success
      res.send('success');
      
    } catch (error) {
      console.error('企业微信消息接收错误:', error);
      res.send('success'); // 即使出错也要返回success
    }
  });

  /** 回复消息方法 */
  wecomapp.reply = async function (replyInfo) {
    try {
      messageProcessor.log(`开始回复消息: ${JSON.stringify({
        type: replyInfo.type,
        target: replyInfo.userId || replyInfo.groupId,
        msgLength: replyInfo.msg ? replyInfo.msg.length : 0
      })}`);
      
      let result = null;
      const targetUser = replyInfo.userId || replyInfo.groupId;
      
      if (!targetUser || targetUser === '0') {
        console.error('企业微信适配器: 无效的目标用户');
        return '';
      }
      
      switch (replyInfo.type) {
        case 'text':
          result = await wecomAPI.sendTextMessage(targetUser, replyInfo.msg);
          break;
          
        case 'image':
        case 'file':
          if (replyInfo.path) {
            // 先上传媒体文件
            const uploadResult = await wecomAPI.uploadMedia('image', replyInfo.path);
            if (uploadResult.errcode === 0) {
              result = await wecomAPI.sendImageMessage(targetUser, uploadResult.media_id);
            } else {
              console.error('企业微信适配器: 上传图片失败', uploadResult);
            }
          }
          break;
          
        default:
          // 默认按文本消息发送
          result = await wecomAPI.sendTextMessage(
            targetUser, 
            `[${replyInfo.type}消息] ${replyInfo.msg || ''}`
          );
          break;
      }
      
      if (result && result.errcode === 0) {
        messageProcessor.log(`消息发送成功: ${result.msgid}`);
        return result.msgid || '';
      } else {
        const errMsg = result ? result.errmsg : '未知错误';
        console.error(`企业微信适配器: 消息发送失败 - ${errMsg}`);
        return '';
      }
      
    } catch (error) {
      console.error(`企业微信适配器回复消息错误: ${error.message}`);
      return '';
    }
  };

  /** 推送消息方法 */
  wecomapp.push = async function (replyInfo) {
    return this.reply(replyInfo);
  };

  /** 撤回消息方法 */
  wecomapp.delMsg = async function (msgId) {
    try {
      if (!msgId) {
        console.error('企业微信适配器: 无效的消息ID');
        return false;
      }
      
      messageProcessor.log(`撤回消息: ${msgId}`);
      // 企业微信不支持撤回通过API发送的消息
      console.log('企业微信适配器: 暂不支持消息撤回功能');
      return false;
      
    } catch (error) {
      console.error(`企业微信适配器撤回消息错误: ${error.message}`);
      return false;
    }
  };

  /** 获取适配器信息 */
  wecomapp.getBotInfo = function () {
    return {
      platform: 'wecomapp',
      corpId: corpId,
      agentId: agentId,
      version: '1.0.0',
      team: 'jingshui'
    };
  };

  console.log(`🎉 企业微信适配器启动成功!`);
  console.log(`🏢 企业ID: ${corpId}`);
  console.log(`📱 应用ID: ${agentId}`);
  console.log(`🔊 监听端口: ${listenPort}`);
  console.log(`🔑 Token: ${receiveToken}`);
  console.log(`🗝️ EncodingAESKey: ${receiveEncodingAESKey ? '已设置' : '未设置'}`);
  console.log(`📝 请在企业微信应用设置中配置接收消息URL: http://你的服务器IP:${listenPort}/api/bot/wecomapp`);

  return wecomapp;
};
