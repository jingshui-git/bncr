/**
* @description 同时监听多个平台(如QQ/TG)的多个群或用户，触发关键字后转发到指定目的地，并在消息中标明来源和时间(时间换行)
* @team xinz
* @author seven（修改支持多平台多群+显示来源+时间换行）
* @platform tgBot qq ssh HumanTG wxQianxun wxXyo wechaty
* @version v3.2.1
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
        .setTitle('启用')
        .setDescription('是否启用此规则')
        .setDefault(true),

      // 一个规则可监听多个平台、多个群或用户
      listen: BncrCreateSchema.array(
        BncrCreateSchema.object({
          from: BncrCreateSchema.string()
            .setTitle('平台')
            .setDescription('填写适配器，如 qq / tgBot / wechaty')
            .setDefault(''),
          type: BncrCreateSchema.string()
            .setTitle('类型')
            .setDescription('群或个人2选1')
            .setEnum(["userId", "groupId"])
            .setEnumNames(['个人', '群'])
            .setDefault("groupId"),
          id: BncrCreateSchema.array(
            BncrCreateSchema.string()
          )
            .setTitle('ID列表')
            .setDescription('群号或个人id，可填写多个')
            .setDefault([])
        })
      )
        .setTitle('监听来源列表')
        .setDescription('支持多个平台的多个群/用户')
        .setDefault([]),

      rule: BncrCreateSchema.array(BncrCreateSchema.string())
        .setTitle('触发关键词，填写“任意”则无视关键字')
        .setDefault(['任意']),

      toSender: BncrCreateSchema.array(
        BncrCreateSchema.object({
          id: BncrCreateSchema.string()
            .setTitle('ID')
            .setDescription('目标群号或个人id')
            .setDefault(""),
          type: BncrCreateSchema.string()
            .setTitle('类型')
            .setDescription('群或个人2选1')
            .setEnum(["userId", "groupId"])
            .setEnumNames(['个人', '群'])
            .setDefault("groupId"),
          from: BncrCreateSchema.string()
            .setTitle('平台')
            .setDescription('填写适配器')
            .setDefault('')
        })
      )
        .setTitle('转发目的地')
        .setDescription('消息会转发到这些目标(可多个)')
        .setDefault([]),

      replace: BncrCreateSchema.array(
        BncrCreateSchema.object({
          old: BncrCreateSchema.string()
            .setTitle('旧消息')
            .setDescription('需要被替换的旧消息')
            .setDefault(""),
          new: BncrCreateSchema.string()
            .setTitle('新消息')
            .setDescription('替换后的新消息')
            .setDefault("")
        })
      )
        .setTitle('替换信息')
        .setDescription('需要替换的消息内容(可多个)')
        .setDefault([]),

      addText: BncrCreateSchema.string()
        .setTitle('自定义尾巴')
        .setDescription('尾部附加的消息，“\\n”表示换行')
        .setDefault("")
    })
  )
    .setTitle('消息转发规则')
    .setDescription('可同时监听多个平台多个群/用户的消息并转发')
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

    const configs = (ConfigDB.userConfig.configs || []).filter(o => o.enable);
    const msgInfo = s.msgInfo;

    console.log(
      `[消息来源] 平台:${msgInfo.from}, 群:${msgInfo.groupId}, 用户:${msgInfo.userId}, 消息:${msgInfo.msg}`
    );

    for (const config of configs) {
      let msgStr = msgInfo.msg;
      let triggered = false;

      // 平台与群号匹配
      const sourceMatched = config.listen.some(src =>
        msgInfo.from === src.from && src.id.includes(msgInfo[src.type])
      );
      if (!sourceMatched) continue;

      // 关键词匹配
      for (const key of config.rule) {
        if (key === '任意' || msgInfo.msg.includes(key)) {
          triggered = true;
          config.replace.forEach(r => {
            if (r.old) msgStr = msgStr.replace(new RegExp(r.old, 'g'), r.new);
          });
          break;
        }
      }
      if (!triggered) continue;

      // 时间格式
      const now = new Date();
      const pad = n => n.toString().padStart(2, '0');
      const timeStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
        now.getDate()
      )} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

      // 来源+时间换行
      const fromType = msgInfo.groupId ? '群' : '用户';
      const fromId = msgInfo.groupId || msgInfo.userId;
      const sourceInfo = `[来源 ${msgInfo.from} ${fromType}:${fromId}]\n[时间 ${timeStr}]`;

      // 拼装完整消息
      const msgToForward = `${msgStr}${config.addText.replaceAll(
        '\\n',
        '\n'
      )}\n${sourceInfo}`;

      // 推送转发
      config.toSender.forEach(t => {
        const obj = {
          platform: t.from,
          msg: msgToForward
        };
        obj[t.type] = t.id;
        sysMethod.push(obj);
      });
    }
  } catch (err) {
    console.debug(err);
  }
  return 'next';
};