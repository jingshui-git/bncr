/**
* @description 多规则独立配置的多平台消息转发：自动识别并转发图片、视频、语音、文件消息
* @team jingshui
* @author seven（增强版：支持QQ CQ 码解析）
* @platform tgBot qq ssh HumanTG wxQianxun wxXyo wechaty
* @version v3.3.0
* @name 消息转发
* @rule [\s\S]+
* @priority 100000
* @admin false
* @disable false
* @public true
* @classification ["功能插件"]
*/

const jsonSchema = BncrCreateSchema.object({
  configs: BncrCreateSchema.array(
    BncrCreateSchema.object({
      enable: BncrCreateSchema.boolean().setTitle('启用').setDefault(true),
      showSource: BncrCreateSchema.boolean().setTitle('显示来源').setDefault(true),
      showTime: BncrCreateSchema.boolean().setTitle('显示时间').setDefault(true),
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
        .setDescription('尾部追加信息，“\\n”换行')
        .setDefault('')
    })
  )
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

/* 解析QQ CQ 码: 返回 {type,path,text} */
function parseCQCode(msg) {
  const res = { type: 'text', path: '', text: msg };
  if (!msg) return res;
  const match = msg.match(/\[CQ:(image|video|record|file).*?(?:url=|file=)([^,\]]+)/i);
  if (match) {
    res.type = match[1] === 'record' ? 'audio' : match[1];
    res.path = decodeURIComponent(match[2]);
    res.text = `[${res.type === 'image' ? '图片' : res.type === 'video' ? '视频' : res.type === 'audio' ? '语音' : '文件'}]`;
  }
  return res;
}

module.exports = async s => {
  try {
    await ConfigDB.get();
    if (!Object.keys(ConfigDB.userConfig).length) {
      console.log('请先配置插件');
      return 'next';
    }
    const configs = (ConfigDB.userConfig.configs || []).filter(o => o.enable);
    const msgInfo = s.msgInfo;
    console.log(`[消息] 平台:${msgInfo.from}, 群:${msgInfo.groupId}, 用户:${msgInfo.userId}, 内容:${msgInfo.msg}`);

    for (const conf of configs) {
      const hitSource = conf.listen.some(src =>
        msgInfo.from === src.from && src.id.includes(String(msgInfo[src.type]))
      );
      if (!hitSource) continue;

      const hitKeyword = conf.rule.some(k =>
        k === '任意' || (k && msgInfo.msg.includes(k))
      );
      if (!hitKeyword) continue;

      let msgStr = msgInfo.msg;
      let mediaType = 'text';
      let mediaPath = '';

      // 识别QQ消息里的CQ码
      if (msgInfo.from === 'qq' && msgInfo.msg.includes('[CQ:')) {
        const parsed = parseCQCode(msgInfo.msg);
        mediaType = parsed.type;
        mediaPath = parsed.path;
        msgStr = parsed.text;
      }

      // 替换文本
      conf.replace.forEach(r => {
        if (r.old) msgStr = msgStr.replace(new RegExp(r.old,'g'), r.new);
      });

      // 来源与时间
      let extra = '';
      if (conf.showSource) {
        const srcType = msgInfo.groupId ? '群' : '用户';
        const srcId = msgInfo.groupId || msgInfo.userId;
        extra += `[来源 ${msgInfo.from} ${srcType}:${srcId}]`;
      }
      if (conf.showTime) {
        const t = new Date();
        const pad = n => n.toString().padStart(2,'0');
        const timeStr = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
        extra += `${extra ? '\n' : ''}[时间 ${timeStr}]`;
      }
      const sendText = `${msgStr}${conf.addText.replaceAll('\\n','\n')}${extra ? '\n'+extra : ''}`;

      // 转发
      for (const dst of conf.toSender) {
        const obj = { platform: dst.from };
        obj[dst.type] = dst.id;

        if (mediaType !== 'text' && mediaPath) {
          obj.type = mediaType;
          obj.path = mediaPath;
        } else {
          obj.type = 'text';
          obj.msg = sendText;
        }
        sysMethod.push(obj);
      }
    }
  } catch (err) {
    console.error('消息转发插件错误:', err);
  }
  return 'next';
};
