/**
* @description 多规则独立配置的多平台消息转发：自动识别并转发图片、视频、语音、文件消息
* @team jingshui
* @author seven（优化图片消息处理和格式）
* @platform tgBot qq ssh HumanTG wxQianxun wxXyo wechaty wxQianxunPro wecomapp
* @version 5.2.0
* @name 消息转发
* @rule [\s\S]+
* @priority 100000
* @admin false
* @disable false
* @public false
* @classification ["功能插件"]
*/

const jsonSchema = BncrCreateSchema.object({
  configs: BncrCreateSchema.array(
    BncrCreateSchema.object({
      enable: BncrCreateSchema.boolean().setTitle('启用').setDefault(true),
      showSource: BncrCreateSchema.boolean().setTitle('显示来源').setDefault(true),
      showTime: BncrCreateSchema.boolean().setTitle('显示时间').setDefault(true),
      
      // 消息类型过滤
      messageFilter: BncrCreateSchema.object({
        enableText: BncrCreateSchema.boolean().setTitle('转发文字消息').setDefault(true),
        enableImage: BncrCreateSchema.boolean().setTitle('转发图片消息').setDefault(true),
        enableFile: BncrCreateSchema.boolean().setTitle('转发文件消息').setDefault(true),
        enableVoice: BncrCreateSchema.boolean().setTitle('转发语音消息').setDefault(false),
        enableVideo: BncrCreateSchema.boolean().setTitle('转发视频消息').setDefault(false)
      }).setTitle('消息类型过滤').setDefault({}),

      listen: BncrCreateSchema.array(
        BncrCreateSchema.object({
          from: BncrCreateSchema.string().setTitle('监听平台').setDefault(''),
          type: BncrCreateSchema.string()
            .setTitle('监听类型')
            .setEnum(["userId","groupId"])
            .setEnumNames(["个人","群"])
            .setDefault("groupId"),
          id: BncrCreateSchema.array(BncrCreateSchema.string())
            .setTitle('监听ID列表').setDefault([])
        })
      ).setTitle('监听来源').setDefault([]),

      rule: BncrCreateSchema.array(BncrCreateSchema.string())
        .setTitle('触发关键词').setDefault(['任意']),

      toSender: BncrCreateSchema.array(
        BncrCreateSchema.object({
          id: BncrCreateSchema.string().setTitle('目标ID').setDefault(""),
          type: BncrCreateSchema.string()
            .setTitle('目标类型')
            .setEnum(["userId","groupId"])
            .setEnumNames(["个人","群"]).setDefault("groupId"),
          from: BncrCreateSchema.string()
            .setTitle('目标平台').setDefault('')
        })
      ).setTitle('转发目标').setDefault([]),

      replace: BncrCreateSchema.array(
        BncrCreateSchema.object({
          old: BncrCreateSchema.string().setTitle('旧消息').setDefault(""),
          new: BncrCreateSchema.string().setTitle('新消息').setDefault("")
        })
      ).setTitle('替换信息').setDefault([]),

      addText: BncrCreateSchema.string()
        .setTitle('自定义尾巴')
        .setDescription('尾部追加信息，"\\n"换行')
        .setDefault(''),
      
      // 高级设置
      advanced: BncrCreateSchema.object({
        enableDebug: BncrCreateSchema.boolean().setTitle('启用调试日志').setDefault(false),
        retryOnFail: BncrCreateSchema.boolean().setTitle('失败重试').setDefault(true),
        maxRetries: BncrCreateSchema.number().setTitle('最大重试次数').setDefault(3),
        enableSourceInfo: BncrCreateSchema.boolean().setTitle('启用来源信息').setDefault(true),
        cacheEnabled: BncrCreateSchema.boolean().setTitle('启用消息缓存').setDefault(true)
      }).setTitle('高级设置').setDefault({})
    })
  )
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

// 消息处理器类
class MessageProcessor {
  constructor() {
    this.debug = false;
    this.messageCache = new Map(); // 消息去重缓存
    this.platformNames = {
      'qq': 'QQ',
      'wxQianxunPro': '微信',
      'wxQianxun': '微信',
      'wechaty': '微信',
      'tgBot': 'Telegram',
      'HumanTG': 'Telegram',
      'wecomapp': '企业微信',
      'ssh': 'SSH',
      'wxXyo': '微信'
    };
  }
  
  setDebug(debug) {
    this.debug = debug;
  }
  
  log(message) {
    if (this.debug) {
      console.log(`[消息转发 v5.2.0] ${message}`);
    }
  }
  
  // 自动清理临时图片和缓存
  cleanup() {
    this.cleanupTempImages();
    this.cleanupMessageCache();
  }
  
  cleanupTempImages() {
    try {
      const fs = require('fs');
      const path = require('path');
      const tempDir = '/bncr/BncrData/temp_images';
      
      if (!fs.existsSync(tempDir)) return;
      
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      let cleanedCount = 0;
      
      for (const file of files) {
        try {
          const filePath = path.join(tempDir, file);
          const stats = fs.statSync(filePath);
          
          if (now - stats.mtimeMs > oneHour) {
            fs.unlinkSync(filePath);
            cleanedCount++;
          }
        } catch {
          // 忽略错误
        }
      }
      
      if (cleanedCount > 0 && this.debug) {
        this.log(`🧹 清理 ${cleanedCount} 个过期图片文件`);
      }
    } catch (error) {
      // 静默处理错误
    }
  }
  
  // 清理消息缓存
  cleanupMessageCache() {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;
    
    for (const [key, timestamp] of this.messageCache.entries()) {
      if (now - timestamp > fiveMinutes) {
        this.messageCache.delete(key);
      }
    }
  }
  
  // 消息去重检查
  isDuplicateMessage(msgInfo) {
    const cacheKey = `${msgInfo.from}_${msgInfo.msgId}_${msgInfo.msg}`;
    const now = Date.now();
    
    if (this.messageCache.has(cacheKey)) {
      return true;
    }
    
    this.messageCache.set(cacheKey, now);
    return false;
  }

  // 处理wxQianxunPro图片消息格式
  parseWxQianxunProImage(msg) {
    const picReg = /\[pic=([^,]+),isDecrypt=1\]/i;
    const match = msg.match(picReg);
    
    if (match?.[1]) {
      const localPath = match[1].replace(/\\/g, '/');
      const textContent = msg.replace(/\[pic=[^\]]+\]/g, '').trim();
      
      this.log(`解析wxQianxunPro图片: ${require('path').basename(localPath)}`);
      
      return {
        type: 'image',
        localPath,
        originalMsg: msg,
        hasImage: true,
        fileName: require('path').basename(localPath),
        textContent
      };
    }
    
    return {
      type: 'text',
      originalMsg: msg,
      hasImage: false,
      textContent: msg
    };
  }

  // 解析 QQ CQ 码
  parseCQ(msg) {
    if (!msg) return { type: 'text', text: '', url: '', hasMedia: false, mediaType: '' };
    
    // 检查CQ图片码
    if (msg.includes('[CQ:image')) {
      const urlReg = /\[CQ:image[^\]]*?url=([^,\]]+)/i;
      const urlMatch = msg.match(urlReg);
      
      if (urlMatch?.[1]) {
        const url = decodeURIComponent(urlMatch[1]);
        const textContent = msg.replace(/\[CQ:[^\]]+\]/g, '').trim();
        const hasText = textContent.length > 0;
        
        this.log(hasText ? 
          `解析QQ混合消息: 图片 + 文字 "${textContent.substring(0, 50)}"` : 
          '解析QQ纯图片消息'
        );
        
        return {
          type: hasText ? 'mixed' : 'image',
          text: textContent,
          url,
          hasMedia: true,
          mediaType: 'image'
        };
      }
    }
    
    return { type: 'text', text: msg, url: '', hasMedia: false, mediaType: '' };
  }

  // 解析微信XML消息
  parseWechatXML(xmlContent) {
    try {
      if (!xmlContent?.includes('<msg>')) {
        return { type: 'text', content: xmlContent };
      }
      
      const title = xmlContent.match(/<title>([^<]+)<\/title>/)?.[1] || '';
      const description = xmlContent.match(/<des>([^<]*)<\/des>/)?.[1] || '';
      const referContent = xmlContent.match(/<content>([^<]+)<\/content>/)?.[1] || '';
      
      const readableContent = [
        title && `📱 分享: ${title}`,
        description && `📝 ${description}`,
        referContent && `💬 引用: ${referContent}`
      ].filter(Boolean).join('\n') || '[微信消息]';
      
      this.log(`解析微信XML消息: ${title || '无标题'}`);
      
      return { 
        type: 'xml_message', 
        content: readableContent,
        title,
        description 
      };
    } catch (error) {
      return { type: 'text', content: '[微信特殊消息]' };
    }
  }

  // 获取平台显示名称
  getPlatformDisplayName(platform) {
    return this.platformNames[platform] || platform;
  }

  // 构建额外信息
  buildExtraInfo(msgInfo, conf) {
    const parts = [];
    
    if (conf.showSource && conf.advanced?.enableSourceInfo !== false) {
      const srcType = msgInfo.groupId && msgInfo.groupId !== '0' ? '群' : '用户';
      const platformName = this.getPlatformDisplayName(msgInfo.from);
      const sourceId = msgInfo.groupId && msgInfo.groupId !== '0' ? msgInfo.groupId : msgInfo.userId;
      parts.push(`[来自${platformName}${srcType}:${sourceId}]`);
    }
    
    if (conf.showTime) {
      const t = new Date();
      const timeStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      parts.push(`[${timeStr}]`);
    }
    
    return parts.join('\n');
  }

  // 检查消息类型是否允许转发
  isMessageTypeAllowed(msgInfo, conf) {
    if (!conf.messageFilter) return true;
    
    const { enableText, enableImage, enableVoice, enableVideo } = conf.messageFilter;
    
    // 检测消息类型
    const isImageMessage = 
      (msgInfo.from === 'wxQianxunPro' && msgInfo.msg.includes('[pic=')) ||
      (msgInfo.from === 'qq' && msgInfo.msg.includes('[CQ:image')) ||
      (msgInfo.from === 'wecomapp' && (!msgInfo.msg || msgInfo.msg === ''));
    
    const isVoiceMessage = msgInfo._isVoice === true;
    const isVideoMessage = msgInfo._isVideo === true;
    
    // 类型过滤检查
    if (isImageMessage && !enableImage) {
      this.log('图片消息被过滤');
      return false;
    }
    if (isVoiceMessage && !enableVoice) {
      this.log('语音消息被过滤');
      return false;
    }
    if (isVideoMessage && !enableVideo) {
      this.log('视频消息被过滤');
      return false;
    }
    if (!isImageMessage && !isVoiceMessage && !isVideoMessage && !enableText) {
      this.log('文字消息被过滤');
      return false;
    }
    
    return true;
  }

  // 应用替换规则
  applyReplaceRules(text, replaceRules) {
    if (!text || !replaceRules?.length) return text;
    
    let result = text;
    for (const rule of replaceRules) {
      if (rule.old) {
        const original = result;
        result = result.replace(new RegExp(rule.old, 'g'), rule.new || '');
        if (original !== result) {
          this.log(`应用替换: "${rule.old}" -> "${rule.new}"`);
        }
      }
    }
    return result;
  }

  // 构建最终消息内容
  buildFinalMessage(baseContent, extraInfo, addText) {
    const parts = [baseContent];
    
    if (addText) {
      parts.push(addText.replaceAll('\\n', '\n'));
    }
    
    if (extraInfo) {
      parts.push(extraInfo);
    }
    
    return parts.filter(part => part && part.trim()).join('\n').trim();
  }

  // 处理相同平台消息转发
  handleSamePlatformForward(msgInfo, dst, conf) {
    this.log(`🔄 相同平台转发: ${msgInfo.from} -> ${dst.from}`);
    
    let finalMsg = msgInfo.msg;
    let isImageMessage = false;
    let imagePath = '';

    // 处理wxQianxunPro图片消息
    if (msgInfo.from === 'wxQianxunPro' && msgInfo.msg.includes('[pic=')) {
      const parsed = this.parseWxQianxunProImage(msgInfo.msg);
      if (parsed.hasImage) {
        isImageMessage = true;
        imagePath = parsed.localPath;
        finalMsg = parsed.textContent;
        this.log(`提取图片路径: ${imagePath}`);
      }
    }

    // 应用替换规则
    finalMsg = this.applyReplaceRules(finalMsg, conf.replace);
    
    const obj = { platform: dst.from };
    obj[dst.type] = dst.id;
    
    const extra = this.buildExtraInfo(msgInfo, conf);
    const textContent = this.buildFinalMessage(finalMsg, extra, conf.addText);
    
    // 处理消息发送
    if (isImageMessage && imagePath) {
      this.log(`发送图片到相同平台`);
      obj.type = 'file';
      obj.path = imagePath;
      obj.msg = textContent || '[图片]';
    } else {
      obj.type = 'text';
      obj.msg = textContent;
    }
    
    this.log(`发送对象: 类型=${obj.type}, 目标=${obj[dst.type]}`);
    return obj;
  }

  // 处理跨平台消息转发
  handleCrossPlatformForward(msgInfo, dst, conf) {
    this.log(`🌐 跨平台转发: ${msgInfo.from} -> ${dst.from}`);
    
    let finalMsg = msgInfo.msg;
    let mediaType = '';
    let mediaSource = '';

    // 检测消息类型
    if (msgInfo.from === 'wxQianxunPro' && msgInfo.msg.includes('[pic=')) {
      const parsed = this.parseWxQianxunProImage(msgInfo.msg);
      if (parsed.hasImage) {
        mediaType = 'image';
        finalMsg = parsed.textContent;
        mediaSource = '微信';
      }
    } else if (msgInfo.from === 'qq' && msgInfo.msg.includes('[CQ:')) {
      const parsed = this.parseCQ(msgInfo.msg);
      if (parsed.hasMedia) {
        mediaType = 'image';
        finalMsg = parsed.text;
        mediaSource = 'QQ';
      }
    } else if (msgInfo.from === 'wecomapp') {
      if (!msgInfo.msg || msgInfo.msg === '') {
        if (msgInfo._isImage) {
          mediaType = 'image';
          mediaSource = '企业微信';
        } else if (msgInfo._isVoice) {
          mediaType = 'voice';
          mediaSource = '企业微信';
        } else if (msgInfo._isVideo) {
          mediaType = 'video';
          mediaSource = '企业微信';
        }
      }
    } else if ((msgInfo.from.includes('wx') || msgInfo.from === 'wxQianxunPro') && 
        msgInfo.msg.includes('<msg>')) {
      const parsedXML = this.parseWechatXML(msgInfo.msg);
      finalMsg = parsedXML.content;
      this.log('检测到微信XML消息');
    }

    // 应用替换规则
    finalMsg = this.applyReplaceRules(finalMsg, conf.replace);
    
    const obj = { platform: dst.from };
    obj[dst.type] = dst.id;
    
    const extra = this.buildExtraInfo(msgInfo, conf);
    
    // 构建最终消息
    let textContent = finalMsg || '';
    
    // 添加媒体提示
    const mediaIcons = { image: '🖼️', voice: '🎤', video: '📹' };
    if (mediaType && mediaIcons[mediaType]) {
      const mediaLabel = `${mediaIcons[mediaType]} [${mediaSource}${mediaType === 'image' ? '图片' : mediaType === 'voice' ? '语音' : '视频'}消息]`;
      textContent = textContent ? `${mediaLabel}\n${textContent}` : mediaLabel;
      this.log(`生成${mediaType}提示消息`);
    }
    
    textContent = this.buildFinalMessage(textContent, extra, conf.addText);
    
    obj.type = 'text';
    obj.msg = textContent;
    
    this.log(`跨平台转发到 ${dst.from}: ${textContent.substring(0, 100)}`);
    return obj;
  }

  // 验证目标配置
  validateTargetConfig(dst, msgInfo) {
    if (!dst.from || !dst.id) {
      this.log(`跳过无效目标: 平台=${dst.from}, ID=${dst.id}`);
      return false;
    }
    
    const validPlatforms = ['qq', 'wxQianxunPro', 'wxQianxun', 'wechaty', 'tgBot', 'HumanTG', 'wecomapp', 'ssh', 'wxXyo'];
    if (!validPlatforms.includes(dst.from)) {
      this.log(`目标平台可能配置错误: ${dst.from}`);
    }
    
    return true;
  }

  // 发送消息（带重试机制）
  async sendMessage(sendObj, conf, retryCount = 0) {
    try {
      if (!sendObj?.msg) {
        this.log('跳过发送: 消息内容为空');
        return false;
      }
      
      sysMethod.push(sendObj);
      this.log(`消息已推送到发送队列: ${sendObj.platform} -> ${sendObj[sendObj.groupId ? 'groupId' : 'userId']}`);
      return true;
      
    } catch (error) {
      this.log(`发送失败: ${error.message}`);
      
      // 重试逻辑
      const maxRetries = conf.advanced?.maxRetries || 3;
      if (conf.advanced?.retryOnFail && retryCount < maxRetries) {
        this.log(`第${retryCount + 1}次重试...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return await this.sendMessage(sendObj, conf, retryCount + 1);
      }
      
      return false;
    }
  }
}

// 创建处理器实例
const messageProcessor = new MessageProcessor();

module.exports = async s => {
  try {
    await ConfigDB.get();
    const configs = (ConfigDB.userConfig.configs || []).filter(o => o.enable);
    const msgInfo = s.msgInfo;

    if (!configs.length) return 'next';

    // 设置调试模式
    const debugMode = configs.some(conf => conf.advanced?.enableDebug);
    messageProcessor.setDebug(debugMode);

    // 清理资源
    messageProcessor.cleanup();

    // 记录接收到的消息
    messageProcessor.log(`📨 收到消息: 平台=${msgInfo.from}, 用户=${msgInfo.userId}, 群组=${msgInfo.groupId}`);
    
    if (debugMode) {
      messageProcessor.log(`消息内容: ${msgInfo.msg ? msgInfo.msg.substring(0, 200) : '[空消息]'}`);
    }

    // 消息去重检查
    const cacheEnabled = configs.some(conf => conf.advanced?.cacheEnabled !== false);
    if (cacheEnabled && messageProcessor.isDuplicateMessage(msgInfo)) {
      messageProcessor.log('跳过重复消息');
      return 'next';
    }

    let processedCount = 0;

    for (const conf of configs) {
      // 检查来源匹配
      const hitSource = conf.listen.some(src =>
        msgInfo.from === src.from && src.id.includes(String(msgInfo[src.type]))
      );
      if (!hitSource) {
        messageProcessor.log(`来源不匹配: ${msgInfo.from} ${msgInfo[msgInfo.groupId ? 'groupId' : 'userId']}`);
        continue;
      }

      // 检查关键词匹配
      const hitKeyword = conf.rule.some(k =>
        k === '任意' || (k && msgInfo.msg?.includes(k)) ||
        (msgInfo.from === 'wecomapp' && (!msgInfo.msg || msgInfo.msg === '') && k === '任意')
      );
      if (!hitKeyword) {
        messageProcessor.log(`关键词不匹配: ${msgInfo.msg ? msgInfo.msg.substring(0, 50) : '[空消息]'}`);
        continue;
      }

      // 检查消息类型过滤
      if (!messageProcessor.isMessageTypeAllowed(msgInfo, conf)) {
        continue;
      }

      messageProcessor.log(`✅ 配置匹配成功，开始处理消息`);

      // 转发到各个目标
      for (const dst of conf.toSender) {
        try {
          if (!messageProcessor.validateTargetConfig(dst, msgInfo)) {
            continue;
          }

          messageProcessor.log(`🎯 准备转发到: 平台=${dst.from}, 类型=${dst.type}, ID=${dst.id}`);

          const sendObj = msgInfo.from === dst.from ? 
            messageProcessor.handleSamePlatformForward(msgInfo, dst, conf) :
            messageProcessor.handleCrossPlatformForward(msgInfo, dst, conf);
          
          if (await messageProcessor.sendMessage(sendObj, conf)) {
            processedCount++;
          }
          
        } catch (sendError) {
          messageProcessor.log(`发送到 ${dst.from} 失败: ${sendError.message}`);
        }
      }
    }

    if (processedCount > 0) {
      messageProcessor.log(`🎉 消息转发完成，共发送 ${processedCount} 条消息`);
    } else {
      messageProcessor.log(`ℹ️ 没有消息需要转发`);
    }

  } catch (err) {
    console.error('消息转发插件错误:', err);
  }
  
  return 'next';
};
