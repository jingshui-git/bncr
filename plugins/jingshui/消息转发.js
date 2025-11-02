/**
* @description 多规则独立配置的多平台消息转发：支持监听指定群或用户，命中关键词后转发到指定群或用户(附来源与时间)
* @team jingshui
* @platform tgBot qq ssh HumanTG wxQianxun wxXyo wechaty
* @version v3.2.2
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
      enable: BncrCreateSchema.boolean()
        .setTitle("启用")
        .setDescription("是否启用该规则")
        .setDefault(true),

      listen: BncrCreateSchema.array(
        BncrCreateSchema.object({
          from: BncrCreateSchema.string()
            .setTitle("监听平台")
            .setDescription("如 qq / tgBot / wechaty")
            .setDefault(""),
          type: BncrCreateSchema.string()
            .setTitle("监听类型")
            .setDescription("群或个人2选1")
            .setEnum(["userId", "groupId"])
            .setEnumNames(["个人", "群"])
            .setDefault("groupId"),
          id: BncrCreateSchema.array(
            BncrCreateSchema.string()
          )
            .setTitle("监听ID列表")
            .setDescription("群号或个人ID，可填写多个")
            .setDefault([])
        })
      )
        .setTitle("监听来源")
        .setDescription("配置多个来源，包含群和用户")
        .setDefault([]),

      rule: BncrCreateSchema.array(BncrCreateSchema.string())
        .setTitle("关键词")
        .setDescription('触发关键词，填写“任意”则不限制')
        .setDefault(["任意"]),

      toSender: BncrCreateSchema.array(
        BncrCreateSchema.object({
          id: BncrCreateSchema.string()
            .setTitle("目标ID")
            .setDescription("目标群号或个人ID")
            .setDefault(""),
          type: BncrCreateSchema.string()
            .setTitle("目标类型")
            .setDescription("群或个人2选1")
            .setEnum(["userId", "groupId"])
            .setEnumNames(["个人", "群"])
            .setDefault("groupId"),
          from: BncrCreateSchema.string()
            .setTitle("目标平台")
            .setDescription("填写适配器，如 qq / tgBot")
            .setDefault("")
        })
      )
        .setTitle("转发目标")
        .setDescription("命中规则后转发到的群/用户，可多个")
        .setDefault([]),

      replace: BncrCreateSchema.array(
        BncrCreateSchema.object({
          old: BncrCreateSchema.string()
            .setTitle("旧消息")
            .setDescription("需要被替换的旧内容")
            .setDefault(""),
          new: BncrCreateSchema.string()
            .setTitle("新消息")
            .setDescription("替换后的新内容")
            .setDefault("")
        })
      )
        .setTitle("替换内容")
        .setDescription("支持多个替换规则")
        .setDefault([]),

      addText: BncrCreateSchema.string()
        .setTitle("尾部追加内容")
        .setDescription("添加在消息末尾，“\\n” 换行")
        .setDefault("")
    })
  )
    .setTitle("消息转发规则")
    .setDescription("支持多条规则独立配置")
    .setDefault([])
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

module.exports = async s => {
  try {
    // 读取配置
    await ConfigDB.get();
    if (!Object.keys(ConfigDB.userConfig).length) {
      console.log('请先配置插件：输入"修改无界配置"或在前端web配置');
      return 'next';
    }

    const configs = (ConfigDB.userConfig.configs || []).filter(o => o.enable);
    const msgInfo = s.msgInfo;

    console.log(`[消息] 平台:${msgInfo.from}, 群:${msgInfo.groupId}, 用户:${msgInfo.userId}, 内容:${msgInfo.msg}`);

    for (const config of configs) {
      let msgStr = msgInfo.msg;
      let triggered = false;

      // 检查来源是否匹配
      const hitSource = config.listen.some(src =>
        msgInfo.from === src.from &&
        src.id.includes(String(msgInfo[src.type]))
      );
      if (!hitSource) continue;

      // 检查关键词
      const hitKeyword = config.rule.some(k =>
        k === "任意" || (k && msgInfo.msg.includes(k))
      );
      if (!hitKeyword) continue;
      triggered = true;

      // 替换消息内容
      config.replace.forEach(r => {
        if (r.old) msgStr = msgStr.replace(new RegExp(r.old, "g"), r.new);
      });

      // 格式化时间
      const now = new Date();
      const pad = n => n.toString().padStart(2, "0");
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      // 来源与时间信息换行显示
      const fromType = msgInfo.groupId ? "群" : "用户";
      const fromId = msgInfo.groupId || msgInfo.userId;
      const sourceInfo = `[来源 ${msgInfo.from} ${fromType}:${fromId}]\n[时间 ${timeStr}]`;

      if (!triggered) continue;

      // 最终消息
      const msgToSend = `${msgStr}${config.addText.replaceAll("\\n", "\n")}\n${sourceInfo}`;

      // 转发到目标
      config.toSender.forEach(dst => {
        const obj = { platform: dst.from, msg: msgToSend };
        obj[dst.type] = dst.id;
        sysMethod.push(obj);
      });
    }
  } catch (err) {
    console.debug(err);
  }
  return 'next';
};