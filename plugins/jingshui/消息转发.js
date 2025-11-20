/**
* @description 多规则独立配置的多平台消息转发：自动识别并转发图片、视频、语音、文件消息
* @team jingshui
* @author seven（优化图片消息处理和格式）
* @platform tgBot qq ssh HumanTG wxQianxun wxXyo wechaty wxQianxunPro wecomapp
* @version 5.0.0
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
        enableFile: BncrCreateSchema.boolean().setTitle('转发文件消息').setDefault(true)
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
        maxRetries: BncrCreateSchema.number().setTitle('最大重试次数').setDefault(3)
      }).setTitle('高级设置').setDefault({})
    })
  )
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

// 消息处理器类
class MessageProcessor {
  constructor() {
    this.debug = false;
  }
  
  setDebug(debug) {
    this.debug = debug;
  }
  
  log(message) {
    if (this.debug) {
      console.log(`[消息转发] ${message}`);
    }
  }
  
  // 自动清理临时图片函数
  cleanupTempImages() {
    try {
      const fs = require('fs');
      const path = require('path');
      const tempDir = '/bncr/BncrData/temp_images';
      
      if (!fs.existsSync(tempDir)) {
        return;
      }
      
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      const oneHour = 60 * 60 * 1000;
      let cleanedCount = 0;
      
      files.forEach(file => {
        try {
          const filePath = path.join(tempDir, file);
          const stats = fs.statSync(filePath);
          
          if (now - stats.mtimeMs > oneHour) {
            fs.unlinkSync(filePath);
            cleanedCount++;
          }
        } catch (fileError) {
          // 忽略清理错误
        }
      });
      
      if (cleanedCount > 0 && this.debug) {
        this.log(`🧹 自动清理完成，共清理 ${cleanedCount} 个过期图片文件`);
      }
    } catch (error) {
      // 静默处理清理错误
    }
  }

  // 处理wxQianxunPro图片消息格式
  parseWxQianxunProImage(msg) {
    const picReg = /\[pic=([^,]+),isDecrypt=1\]/i;
    const match = msg.match(picReg);
    
    if (match && match[1]) {
      let localPath = match[1].replace(/\\/g, '/');
      
      // 提取文字内容（移除图片代码）
      const textContent = msg.replace(/\[pic=[^\]]+\]/g, '').trim();
      
      this.log(`解析到wxQianxunPro图片: ${require('path').basename(localPath)}`);
      
      return {
        type: 'image',
        localPath: localPath,
        originalMsg: msg,
        hasImage: true,
        fileName: require('path').basename(localPath),
        textContent: textContent
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
    const result = { 
      type: 'text', 
      text: '', 
      url: '',
      hasMedia: false,
      mediaType: ''
    };
    
    if (!msg) return result;
    
    // 检查是否包含CQ图片码
    if (msg.includes('[CQ:image')) {
      const urlReg = /\[CQ:image[^\]]*?url=([^,\]]+)/i;
      const urlMatch = msg.match(urlReg);
      
      if (urlMatch && urlMatch[1]) {
        result.hasMedia = true;
        result.mediaType = 'image';
        result.url = decodeURIComponent(urlMatch[1]);
        
        // 提取文字内容（移除CQ码）
        const textContent = msg.replace(/\[CQ:[^\]]+\]/g, '').trim();
        
        if (textContent) {
          result.type = 'mixed';
          result.text = textContent;
          this.log(`解析到QQ混合消息: 图片 + 文字 "${result.text.substring(0, 50)}"`);
        } else {
          result.type = 'image';
          result.text = '';
          this.log('解析到QQ纯图片消息');
        }
        
        return result;
      }
    }
    
    result.text = msg;
    return result;
  }

  // 解析微信XML消息
  parseWechatXML(xmlContent) {
    try {
      if (!xmlContent || !xmlContent.includes('<msg>')) {
        return { type: 'text', content: xmlContent };
      }
      
      const titleMatch = xmlContent.match(/<title>([^<]+)<\/title>/);
      const title = titleMatch ? titleMatch[1] : '';
      
      const desMatch = xmlContent.match(/<des>([^<]*)<\/des>/);
      const description = desMatch ? desMatch[1] : '';
      
      const referContentMatch = xmlContent.match(/<content>([^<]+)<\/content>/);
      const referContent = referContentMatch ? referContentMatch[1] : '';
      
      let readableContent = '';
      if (title) readableContent += `📱 分享: ${title}`;
      if (description) readableContent += `\n📝 ${description}`;
      if (referContent) readableContent += `\n💬 引用: ${referContent}`;
      
      this.log(`解析到微信XML消息: ${title || '无标题'}`);
      
      return { 
        type: 'xml_message', 
        content: readableContent || '[微信消息]',
        title: title,
        description: description 
      };
    } catch (error) {
      return { type: 'text', content: '[微信特殊消息]' };
    }
  }

  // 获取平台显示名称
  getPlatformDisplayName(platform) {
    const platformNames = {
      'qq': 'QQ',
      'wxQianxunPro': '微信',
      'wxQianxun': '微信',
      'wechaty': '微信',
      'tgBot': 'Telegram',
      'HumanTG': 'Telegram',
      'wecomapp': '企业微信',
      'ssh': 'SSH',
      'wxXyo': '微信',
      'wecomapp': '企业微信'
    };
    return platformNames[platform] || platform;
  }

  // 构建额外信息
  buildExtraInfo(msgInfo, conf) {
    let extra = '';
    
    if (conf.showSource) {
      const srcType = msgInfo.groupId ? '群' : '用户';
      const platformName = this.getPlatformDisplayName(msgInfo.from);
      extra += `[来自${platformName}${srcType}]`;
    }
    
    if (conf.showTime) {
      const t = new Date();
      const pad = n => n.toString().padStart(2, '0');
      const timeStr = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
      extra += `${extra ? '\n' : ''}[${timeStr}]`;
    }
    
    return extra;
  }

  // 检查消息类型是否允许转发
  isMessageTypeAllowed(msgInfo, conf) {
    if (!conf.messageFilter) return true;
    
    // 检查是否为图片消息
    const isImageMessage = 
      (msgInfo.from === 'wxQianxunPro' && msgInfo.msg.includes('[pic=')) ||
      (msgInfo.from === 'qq' && msgInfo.msg.includes('[CQ:image')) ||
      (msgInfo.from === 'wecomapp' && (!msgInfo.msg || msgInfo.msg === ''));
    
    if (isImageMessage && !conf.messageFilter.enableImage) {
      this.log('图片消息被过滤');
      return false;
    }
    
    if (!isImageMessage && !conf.messageFilter.enableText) {
      this.log('文字消息被过滤');
      return false;
    }
    
    return true;
  }

  // 处理相同平台消息转发
  handleSamePlatformForward(msgInfo, dst, conf) {
    this.log(`🔄 相同平台转发: ${msgInfo.from} -> ${dst.from}`);
    
    let finalMsg = msgInfo.msg;
    let isImageMessage = false;
    let imagePath = '';

    // 检查wxQianxunPro图片消息
    if (msgInfo.from === 'wxQianxunPro' && msgInfo.msg.includes('[pic=')) {
      const parsed = this.parseWxQianxunProImage(msgInfo.msg);
      
      if (parsed.hasImage) {
        isImageMessage = true;
        imagePath = parsed.localPath;
        finalMsg = parsed.textContent;
        this.log(`📄 提取图片路径: ${imagePath}`);
      }
    }

    // 应用替换规则
    conf.replace.forEach(r => {
      if (r.old && finalMsg) {
        const original = finalMsg;
        finalMsg = finalMsg.replace(new RegExp(r.old, 'g'), r.new);
        if (original !== finalMsg) {
          this.log(`🔧 应用替换规则: "${r.old}" -> "${r.new}"`);
        }
      }
    });
    
    const obj = { platform: dst.from };
    obj[dst.type] = dst.id;
    
    const extra = this.buildExtraInfo(msgInfo, conf);
    
    // 构建最终内容
    let textContent = finalMsg;
    if (textContent || extra || conf.addText) {
      textContent = `${textContent}${conf.addText.replaceAll('\\n', '\n')}${extra ? '\n' + extra : ''}`.trim();
    }
    
    // 处理消息发送
    if (isImageMessage && imagePath) {
      this.log(`📤 发送图片文件到相同平台`);
      
      // 使用文件方式发送图片
      obj.type = 'file';
      obj.path = imagePath;
      obj.msg = textContent || '[图片]';
      
    } else {
      // 纯文本消息
      obj.type = 'text';
      obj.msg = textContent;
    }
    
    this.log(`🔧 发送对象: 类型=${obj.type}, 目标=${obj[dst.type]}`);
    
    return obj;
  }

  // 处理跨平台消息转发
  handleCrossPlatformForward(msgInfo, dst, conf) {
    this.log(`🌐 跨平台转发: ${msgInfo.from} -> ${dst.from}`);
    
    let finalMsg = msgInfo.msg;
    let isImageMessage = false;
    let imageSource = '';

    // 检查各种消息类型
    if (msgInfo.from === 'wxQianxunPro' && msgInfo.msg.includes('[pic=')) {
      const parsed = this.parseWxQianxunProImage(msgInfo.msg);
      if (parsed.hasImage) {
        isImageMessage = true;
        finalMsg = parsed.textContent;
        imageSource = '微信';
        this.log('🖼️ 检测到微信图片消息');
      }
    }
    else if (msgInfo.from === 'qq' && msgInfo.msg.includes('[CQ:')) {
      const parsed = this.parseCQ(msgInfo.msg);
      if (parsed.hasMedia) {
        isImageMessage = true;
        finalMsg = parsed.text;
        imageSource = 'QQ';
        this.log('🖼️ 检测到QQ图片消息');
      }
    }
    else if (msgInfo.from === 'wecomapp' && (!msgInfo.msg || msgInfo.msg === '')) {
      // 企业微信空消息处理
      isImageMessage = true;
      finalMsg = '';
      imageSource = '企业微信';
      this.log('🖼️ 检测到企业微信图片消息');
    }
    else if ((msgInfo.from.includes('wx') || msgInfo.from === 'wxQianxunPro') && 
        msgInfo.msg.includes('<msg>')) {
      const parsedXML = this.parseWechatXML(msgInfo.msg);
      finalMsg = parsedXML.content;
      this.log('📱 检测到微信XML消息');
    }

    // 应用替换规则
    conf.replace.forEach(r => {
      if (r.old && finalMsg) {
        const original = finalMsg;
        finalMsg = finalMsg.replace(new RegExp(r.old, 'g'), r.new);
        if (original !== finalMsg) {
          this.log(`🔧 应用替换规则: "${r.old}" -> "${r.new}"`);
        }
      }
    });
    
    const obj = { platform: dst.from };
    obj[dst.type] = dst.id;
    
    const extra = this.buildExtraInfo(msgInfo, conf);
    
    // 构建最终消息
    let textContent = finalMsg || '';
    
    // 添加图片提示
    if (isImageMessage) {
      if (textContent) {
        textContent = `🖼️ [${imageSource}图片]\n${textContent}`;
      } else {
        textContent = `🖼️ [${imageSource}图片]`;
      }
      this.log(`📤 生成图片提示消息`);
    }
    
    // 添加自定义文本和额外信息
    if (conf.addText) {
      textContent += conf.addText.replaceAll('\\n', '\n');
    }
    if (extra) {
      textContent += `\n${extra}`;
    }
    
    obj.type = 'text';
    obj.msg = textContent.trim();
    
    this.log(`📤 跨平台转发到 ${dst.from}: ${textContent.substring(0, 100)}`);
    
    return obj;
  }

  // 验证目标配置
  validateTargetConfig(dst, msgInfo) {
    if (!dst.from || !dst.id) {
      this.log(`⚠️ 跳过无效目标: 平台=${dst.from}, ID=${dst.id}`);
      return false;
    }
    
    // 检查平台标识是否正确
    const validPlatforms = ['qq', 'wxQianxunPro', 'wxQianxun', 'wechaty', 'tgBot', 'HumanTG', 'wecomapp', 'ssh', 'wxXyo'];
    if (!validPlatforms.includes(dst.from)) {
      this.log(`⚠️ 目标平台可能配置错误: ${dst.from}`);
    }
    
    return true;
  }

  // 发送消息（带重试机制）
  async sendMessage(sendObj, conf, retryCount = 0) {
    try {
      if (!sendObj || !sendObj.msg) {
        this.log('⚠️ 跳过发送: 消息内容为空');
        return false;
      }
      
      sysMethod.push(sendObj);
      this.log(`🚀 消息已推送到发送队列: ${sendObj.platform} -> ${sendObj[sendObj.groupId ? 'groupId' : 'userId']}`);
      return true;
      
    } catch (error) {
      this.log(`❌ 发送失败: ${error.message}`);
      
      // 重试逻辑
      if (conf.advanced && conf.advanced.retryOnFail && retryCount < (conf.advanced.maxRetries || 3)) {
        this.log(`🔄 第${retryCount + 1}次重试...`);
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
    // 获取配置
    await ConfigDB.get();
    if (!Object.keys(ConfigDB.userConfig).length) {
      return 'next';
    }

    const configs = (ConfigDB.userConfig.configs || []).filter(o => o.enable);
    const msgInfo = s.msgInfo;

    // 设置调试模式
    const debugMode = configs.some(conf => conf.advanced && conf.advanced.enableDebug);
    messageProcessor.setDebug(debugMode);

    // 清理临时图片
    messageProcessor.cleanupTempImages();

    // 记录接收到的消息
    messageProcessor.log(`📨 收到消息: 平台=${msgInfo.from}, 用户=${msgInfo.userId}, 群组=${msgInfo.groupId}, 长度=${msgInfo.msg ? msgInfo.msg.length : 0}`);
    
    if (debugMode) {
      messageProcessor.log(`📝 消息内容: ${msgInfo.msg ? msgInfo.msg.substring(0, 200) : '[空消息]'}`);
    }

    let processedCount = 0;

    for (const conf of configs) {
      // 检查来源匹配
      const hitSource = conf.listen.some(src =>
        msgInfo.from === src.from && src.id.includes(String(msgInfo[src.type]))
      );
      if (!hitSource) {
        messageProcessor.log(`❌ 来源不匹配: ${msgInfo.from} ${msgInfo[msgInfo.groupId ? 'groupId' : 'userId']}`);
        continue;
      }

      // 检查关键词匹配
      const hitKeyword = conf.rule.some(k =>
        k === '任意' || (k && msgInfo.msg && msgInfo.msg.includes(k)) ||
        // 企业微信空消息（图片）也视为匹配
        (msgInfo.from === 'wecomapp' && (!msgInfo.msg || msgInfo.msg === '') && k === '任意')
      );
      if (!hitKeyword) {
        messageProcessor.log(`❌ 关键词不匹配: ${msgInfo.msg ? msgInfo.msg.substring(0, 50) : '[空消息]'}`);
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

          let sendObj;
          
          if (msgInfo.from === dst.from) {
            // 相同平台转发
            sendObj = messageProcessor.handleSamePlatformForward(msgInfo, dst, conf);
          } else {
            // 跨平台转发
            sendObj = messageProcessor.handleCrossPlatformForward(msgInfo, dst, conf);
          }
          
          // 发送消息
          const success = await messageProcessor.sendMessage(sendObj, conf);
          if (success) {
            processedCount++;
          }
          
        } catch (sendError) {
          messageProcessor.log(`❌ 发送到 ${dst.from} 失败: ${sendError.message}`);
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
