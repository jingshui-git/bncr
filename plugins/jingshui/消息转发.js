/**
* @description 同时监听多个平台(如QQ/TG)的多个群或用户，触发关键字后转发到指定目的地，并在消息中标明来源和时间(时间换行)
* @team jingshui
* @author seven（修改支持多平台多群+显示来源+时间换行）
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
      enable: BncrCreateSchema.boolean().setTitle('启用').setDescription('是否启用此规则').setDefault(true),

      // 支持一个规则监听多个平台多个群/用户
      listen: BncrCreateSchema.array(
        BncrCreateSchema.object({
          from: BncrCreateSchema.string()
            。setTitle('平台')
            。setDescription('填写适配器，如 qq / tgBot / wechaty')
            。setDefault(''),
          type: BncrCreateSchema.string()
            。setTitle('类型')
            。setDescription('群或个人2选1')
            。setEnum(["userId", "groupId"])
            。setEnumNames(['个人', '群'])
            。setDefault("groupId"),
          id: BncrCreateSchema.array(
            BncrCreateSchema.string()
          ).setTitle('ID列表')
           .setDescription('群号或个人id，可填写多个')
           .setDefault([])
        })
      ).setTitle('监听来源列表')
       .setDescription('一个规则可同时监听多个平台的多个群/用户')
       .setDefault([]),

      rule: BncrCreateSchema.array(
        BncrCreateSchema.string()
      ).setTitle('触发关键词，填写“任意”则无视关键字')
       .setDefault(['任意']),

      toSender: BncrCreateSchema.array(
        BncrCreateSchema.object({
          id: BncrCreateSchema.string().setTitle('ID').setDescription('目标群号或个人id').setDefault(""),
          type: BncrCreateSchema.string().setTitle('类型').setDescription('群或个人2选1')
            .setEnum(["userId", "groupId"])
            .setEnumNames(['个人', '群'])
            .setDefault("groupId"),
          from: BncrCreateSchema.string().setTitle('平台').setDescription('填写适配器').setDefault('')
        })
      ).setTitle('转发目的地')
       .setDescription('消息会转发到这些目标(可多个)')
       .setDefault([]),

      replace: BncrCreateSchema.array(
        BncrCreateSchema.object({
          old: BncrCreateSchema.string().setTitle('旧消息').setDescription('需要被替换的旧消息').setDefault(""),
          new: BncrCreateSchema.string().setTitle('新消息').setDescription('替换后的新消息').setDefault("")
        })
      ).setTitle('替换信息')
       .setDescription('需要替换的消息内容(可多个)')
       .setDefault([]),

      addText: BncrCreateSchema.string()
        .setTitle('自定义尾巴')
        .setDescription('尾部附加的消息，“\\n”表示换行')
        .setDefault("")
    })
  ).setTitle('消息转发规则')
   .setDescription('一个规则可同时监听多个平台的多个群/用户')
   .setDefault([])
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

module.exports = async s => {
  try {
    await ConfigDB.get();
    if (!Object.keys(ConfigDB.userConfig).length) {
      console.log('请先配置插件：发送"修改无界配置"或者在前端web配置');
      return 'next';
    }

    const configs = ConfigDB.userConfig.configs.filter(o => o.enable) || [];
    const msgInfo = s.msgInfo;
    console.log(`[消息来源] 平台:${msgInfo.from}, 群:${msgInfo.groupId}, 用户:${msgInfo.userId}, 消息:${msgInfo.msg}`);

    for (const config of configs) {
      let msgStr = msgInfo.msg;
      let open = false;

      // 匹配来源（多平台）
      let matchedSource = false;
      for (const source of config.listen) {
        if (msgInfo.from === source.from && source.id.includes(msgInfo[source.type])) {
          matchedSource = true;
          break;
        }
      }
      if (!matchedSource) continue;

      // 关键词匹配
      for (const rule of config.rule) {
        if (rule === "任意" || (rule && msgInfo.msg.includes(rule))) {
          open = true;
          config.replace.forEach(e => {
            if (e.old) msgStr = msgStr.replace(new RegExp(e.old, 'g'), e.new);
          });
          break;
        }
      }
      if (!open) continue;

      // 格式化当前时间
      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      // 来源+时间信息（时间换行显示）
      const fromType = msgInfo.groupId ? "群" : "用户";
      const fromId   = msgInfo.groupId || msgInfo.userId;
      const sourceInfo = `[来源 ${msgInfo.from} ${fromType}:${fromId}]\n[时间 ${timeStr}]`;

      // 拼接转发消息
      const msgToForward = `${msgStr}${config.addText.replaceAll('\\n', '\n')}\n${sourceInfo}`;

      // 转发到目标
      config.toSender.forEach(e => {
        let obj = {
          platform: e.from,
          msg: msgToForward
        };
        obj[e.type] = e.id;
        sysMethod.push(obj);
      });
    }
  } catch (e) {
    console.debug(e);
  }
  return 'next';
};
