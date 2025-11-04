/**
* @description 多规则独立配置的多平台消息转发：支持监听指定群或用户，命中关键词后转发到指定群或用户(可选来源与时间信息)
* @team jingshui
* @author seven（修改支持多规则、来源与时间显示开关 + QQ CQ码图片/视频识别）
* @platform tgBot qq ssh HumanTG wxQianxun wxXyo wechaty
* @version v3.3.0
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
      enable: BncrCreateSchema.boolean().setTitle("启用").setDefault(true),
      showSource: BncrCreateSchema.boolean().setTitle("显示来源").setDefault(true),
      showTime: BncrCreateSchema.boolean().setTitle("显示时间").setDefault(true),

      listen: BncrCreateSchema.array(
        BncrCreateSchema.object({
          from: BncrCreateSchema.string().setTitle("监听平台").setDefault(""),
          type: BncrCreateSchema.string()
            .setTitle("监听类型")
            .setEnum(["userId","groupId"])
            .setEnumNames(["个人","群"])
            .setDefault("groupId"),
          id: BncrCreateSchema.array(BncrCreateSchema.string())
            .setTitle("监听ID列表").setDefault([])
        })
      ).setTitle("监听来源").setDefault([]),

      rule: BncrCreateSchema.array(BncrCreateSchema.string())
        .setTitle("关键词").setDefault(["任意"]),

      toSender: BncrCreateSchema.array(
        BncrCreateSchema.object({
          id: BncrCreateSchema.string().setTitle("目标ID").setDefault(""),
          type: BncrCreateSchema.string()
            .setTitle("目标类型")
            .setEnum(["userId","groupId"])
            .setEnumNames(["个人","群"])
            .setDefault("groupId"),
          from: BncrCreateSchema.string()
            .setTitle("目标平台").setDefault("")
        })
      ).setTitle("转发目标").setDefault([]),

      replace: BncrCreateSchema.array(
        BncrCreateSchema.object({
          old: BncrCreateSchema.string().setTitle("旧消息").setDefault(""),
          new: BncrCreateSchema.string().setTitle("新消息").setDefault("")
        })
      ).setTitle("替换内容").setDefault([]),

      addText: BncrCreateSchema.string()
        .setTitle("尾部追加内容")
        .setDescription("添加在消息末尾，“\\n”换行")
        .setDefault("")
    })
  )
});
const ConfigDB = new BncrPluginConfig(jsonSchema);

/* 简单解析QQ CQ码 */
function parseCQ(msg){
  const res={type:'text',path:'',text:msg};
  if(!msg)return res;
  const match = msg.match(/\[CQ:(image|video|record|file).*?(?:url=|file=)([^,\]]+)/i);
  if(match){
    res.type = match<source_id data="1" title="publicFileIndex.json" />==='record'?'audio':match<source_id data="1" title="publicFileIndex.json" />;
    res.path = decodeURIComponent(match[2]);
    res.text = `[${res.type==='image'?'图片':res.type==='video'?'视频':res.type==='audio'?'语音':'文件'}]`;
  }
  return res;
}

module.exports = async s=>{
  try{
    await ConfigDB.get();
    if(!Object.keys(ConfigDB.userConfig).length){
      console.log('请先配置插件：发送"修改无界配置"或者在前端web配置');
      return 'next';
    }
    const configs=(ConfigDB.userConfig.configs||[]).filter(o=>o.enable);
    const msgInfo=s.msgInfo;
    console.log(`[消息] 平台:${msgInfo.from}, 群:${msgInfo.groupId}, 用户:${msgInfo.userId}, 内容:${msgInfo.msg}`);

    for(const conf of configs){
      const hitSource=conf.listen.some(src=>{
        return msgInfo.from===src.from && src.id.includes(String(msgInfo[src.type]));
      });
      if(!hitSource)continue;

      const hitKeyword=conf.rule.some(k=>k==='任意'||(k&&msgInfo.msg.includes(k)));
      if(!hitKeyword)continue;

      let msgStr=msgInfo.msg;
      let mediaType='text';
      let mediaPath='';

      // QQ CQ 码解析
      if(msgInfo.from==='qq' && msgInfo.msg.includes('[CQ:')){
        const parsed=parseCQ(msgInfo.msg);
        mediaType=parsed.type;
        mediaPath=parsed.path;
        msgStr=parsed.text;
      }

      conf.replace.forEach(r=>{
        if(r.old)msgStr=msgStr.replace(new RegExp(r.old,'g'),r.new);
      });

      // 来源和时间
      let sourcePart='';
      if(conf.showSource){
        const ft=msgInfo.groupId?'群':'用户';
        const fid=msgInfo.groupId||msgInfo.userId;
        sourcePart+=`[来源 ${msgInfo.from} ${ft}:${fid}]`;
      }
      if(conf.showTime){
        const now=new Date();
        const pad=n=>n.toString().padStart(2,"0");
        const tstr=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        sourcePart+=`${sourcePart?'\n':''}[时间 ${tstr}]`;
      }

      const msgToSend=`${msgStr}${conf.addText.replaceAll('\\n','\n')}${sourcePart?'\n'+sourcePart:''}`;

      for(const dst of conf.toSender){
        const obj={platform:dst.from};
        obj[dst.type]=dst.id;
        if(mediaType!=='text' && mediaPath){
          obj.type=mediaType;
          obj.path=mediaPath;
        }else{
          obj.type='text';
          obj.msg=msgToSend;
        }
        sysMethod.push(obj);
      }
    }
  }catch(err){
    console.debug(err);
  }
  return 'next';
};
