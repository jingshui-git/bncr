/**
 * @author ChatGPT
 * @name wxWorkApp
 * @version 1.0.1-stable
 * @description 企业微信自建应用适配器：支持回调校验、文本接收、文本/Markdown/图片/语音/视频/文件发送、应用消息撤回
 * @adapter true
 * @public false
 * @disable false
 * @priority 2
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const jsonSchema = BncrCreateSchema.object({
  enable: BncrCreateSchema.boolean()
    .setTitle('是否开启适配器')
    .setDescription('设置为关则不加载该适配器')
    .setDefault(false),
  routePath: BncrCreateSchema.string()
    .setTitle('回调路由')
    .setDescription('只填路径，例如 /api/bot/wxWorkApp；误填完整URL时会自动提取 pathname')
    .setDefault('/api/bot/wxWorkApp'),
  testMode: BncrCreateSchema.boolean()
    .setTitle('测试模式')
    .setDescription('仅跳过 msg_signature 校验，但仍会解密 echostr；生产环境请关闭')
    .setDefault(false),
  corpId: BncrCreateSchema.string()
    .setTitle('CorpID')
    .setDescription('企业微信后台「我的企业 - 企业信息」里的企业 ID')
    .setDefault(''),
  corpSecret: BncrCreateSchema.string()
    .setTitle('Secret')
    .setDescription('自建应用 Secret')
    .setDefault(''),
  agentId: BncrCreateSchema.string()
    .setTitle('AgentId')
    .setDescription('自建应用 AgentId，应用详情页可见')
    .setDefault(''),
  token: BncrCreateSchema.string()
    .setTitle('Token')
    .setDescription('自建应用「接收消息服务器配置」里的 Token，需与企业微信后台保持一致')
    .setDefault(''),
  encodingAESKey: BncrCreateSchema.string()
    .setTitle('EncodingAESKey')
    .setDescription('自建应用「接收消息服务器配置」里的 EncodingAESKey，43 位')
    .setDefault(''),
  enableSignatureCheck: BncrCreateSchema.boolean()
    .setTitle('是否校验 msg_signature')
    .setDescription('强烈建议开启；仅本地调试时可临时关闭')
    .setDefault(true),
  receiveNonText: BncrCreateSchema.boolean()
    .setTitle('是否接收非文本消息')
    .setDescription('开启后会把图片/语音/视频/文件/事件转换成文本占位消息进入 Bncr')
    .setDefault(true),
  logRawMessage: BncrCreateSchema.boolean()
    .setTitle('是否打印明文回调 XML')
    .setDescription('排障时可开启，生产环境建议关闭')
    .setDefault(false),
  debugLog: BncrCreateSchema.boolean()
    .setTitle('是否打印调试日志')
    .setDescription('开启后打印URL验证、发送数据、发送响应等调试日志；生产环境建议关闭')
    .setDefault(false),
});

const ConfigDB = new BncrPluginConfig(jsonSchema);

module.exports = async () => {
  await ConfigDB.get();
  const cfg = ConfigDB.userConfig || {};

  if (!Object.keys(cfg).length) return sysMethod.startOutLogs('未配置 wxWorkApp 适配器，退出');
  if (!cfg.enable) return sysMethod.startOutLogs('未启用 wxWorkApp 适配器，退出');

  if (!cfg.corpId) return console.log('[wxWorkApp] 未设置 CorpID');
  if (!cfg.corpSecret) return console.log('[wxWorkApp] 未设置 Secret');
  if (!cfg.agentId) return console.log('[wxWorkApp] 未设置 AgentId');
  if (!cfg.encodingAESKey) return console.log('[wxWorkApp] 未设置 EncodingAESKey');
  if (cfg.enableSignatureCheck && !cfg.token) return console.log('[wxWorkApp] 已开启签名校验，但未设置 Token');

  if (cfg.encodingAESKey.length !== 43) {
    return console.log('[wxWorkApp] EncodingAESKey 长度应为 43 位');
  }

  await ensureModules(['xml2js', 'express-xml-bodyparser', 'form-data']);

  const got = await loadGot();
  const FormData = require('form-data');
  const xmlparser = require('express-xml-bodyparser');
  const { parseStringPromise } = require('xml2js');

  const routePath = normalizeRoutePath(cfg.routePath || '/api/bot/wxWorkApp');
  const db = new BncrDB('wxWorkApp');
  const adapter = new Adapter('wxWorkApp');
  const seenMsgIds = new Map();

  function debugLog(...args) {
    if (cfg.debugLog) console.log(...args);
  }

  router.get(routePath, async (req, res) => {
    try {
      let echostr = req.query.echostr;
      if (Array.isArray(echostr)) echostr = echostr[0];

      debugLog('[wxWorkApp] 收到URL验证GET:', {
        msg_signature: req.query.msg_signature,
        timestamp: req.query.timestamp,
        nonce: req.query.nonce,
        echostr: echostr ? String(echostr).slice(0, 60) + '...' : '',
      });

      if (!echostr) {
        return res
          .status(200)
          .type('text/plain; charset=utf-8')
          .send('wxWorkApp adapter is running');
      }

      if (!cfg.testMode) {
        verifySignature(req.query, echostr);
      } else {
        debugLog('[wxWorkApp] 测试模式：跳过 msg_signature 校验，但仍会解密 echostr');
      }

      const plainEcho = decryptWeCom(echostr);
      debugLog('[wxWorkApp] URL验证成功，返回明文:', plainEcho);

      return res
        .status(200)
        .type('text/plain; charset=utf-8')
        .send(String(plainEcho));
    } catch (err) {
      console.error('[wxWorkApp] URL 验证失败:', err && err.stack ? err.stack : err);
      return res
        .status(400)
        .type('text/plain; charset=utf-8')
        .send('');
    }
  });

  router.post(
    routePath,
    xmlparser({ explicitArray: false, normalize: false, normalizeTags: false, trim: false }),
    async (req, res) => {
      try {
        const bodyXml = req.body && (req.body.xml || req.body.XML || req.body);
        const encrypt = pick(bodyXml, ['Encrypt', 'encrypt']);
        if (!encrypt) throw new Error('回调 XML 中没有 Encrypt 字段');

        verifySignature(req.query, encrypt);

        const plainXml = decryptWeCom(encrypt);
        if (cfg.logRawMessage) console.log('[wxWorkApp] 明文回调 XML:', plainXml);

        const parsed = await parseStringPromise(plainXml, { explicitArray: false, trim: true });
        const msg = parsed.xml || parsed;

        const agentId = pick(msg, ['AgentID', 'AgentId', 'agentid']);
        if (agentId) await db.set('agentId', String(agentId));

        const msgId = String(pick(msg, ['MsgId', 'MsgID', 'msgid']) || makeFallbackMsgId(msg));
        if (isDuplicate(msgId)) return res.send('success');

        const msgType = String(pick(msg, ['MsgType', 'msgtype']) || '').toLowerCase();
        const userId = String(pick(msg, ['FromUserName', 'fromusername']) || '');
        const text = toBncrTextMessage(msg, msgType);

        if (!text) return res.send('success');
        if (msgType !== 'text' && !cfg.receiveNonText) return res.send('success');

        const msgInfo = {
          userId,
          userName: userId,
          groupId: '0',
          groupName: '',
          msg: text,
          msgId,
          type: 'Social',
          fromType: 'Social',
          raw: msg,
        };

        adapter.receive(msgInfo);
        return res.send('success');
      } catch (err) {
        console.error('[wxWorkApp] 接收消息失败:', err);
        return res.send('success');
      }
    }
  );

  adapter.reply = async function reply(replyInfo = {}) {
    const body = await buildSendBody(replyInfo);
    return sendMsg(body);
  };

  adapter.push = async function push(replyInfo = {}) {
    return adapter.reply(replyInfo);
  };

  adapter.delMsg = async function delMsg(...args) {
    const msgid = flatten(args).filter(Boolean).pop();
    if (!msgid) return false;

    try {
      const accessToken = await getAccessToken();
      const url = `https://qyapi.weixin.qq.com/cgi-bin/message/recall?access_token=${accessToken}`;
      const json = await postJson(url, { msgid: String(msgid) });
      if (json.errcode === 0) return true;
      console.log('[wxWorkApp] 撤回失败:', JSON.stringify(json));
      return false;
    } catch (err) {
      console.error('[wxWorkApp] 撤回异常:', err);
      return false;
    }
  };

  adapter.Bridge = {
    getAccessToken,
    sendRaw: sendMsg,
    uploadMedia,
    routePath,
  };

  sysMethod.startOutLogs(`wxWorkApp 适配器已加载，回调路径：${routePath}`);
  return adapter;

  async function ensureModules(modules) {
    for (const mod of modules) {
      try {
        require.resolve(mod);
      } catch (err) {
        if (sysMethod && sysMethod.npmInstall) {
          console.log(`[wxWorkApp] 缺少依赖 ${mod}，尝试自动安装...`);
          await sysMethod.npmInstall(mod, { outConsole: true });
        } else {
          throw err;
        }
      }
    }
  }

  async function loadGot() {
    try {
      const mod = require('got');
      return mod.default || mod;
    } catch (err) {
      if (sysMethod && sysMethod.npmInstall) {
        console.log('[wxWorkApp] 缺少依赖 got，尝试自动安装...');
        await sysMethod.npmInstall('got', { outConsole: true });
      }
      const mod = await import('got');
      return mod.default || mod;
    }
  }

  function normalizeRoutePath(input) {
    let s = String(input || '').trim() || '/api/bot/wxWorkApp';

    // 兼容误填完整 URL 的情况：
    // https://example.com:9527/api/bot/wxWorkApp -> /api/bot/wxWorkApp
    if (/^https?:\/\//i.test(s)) {
      try {
        const url = new URL(s);
        s = url.pathname || '/api/bot/wxWorkApp';
      } catch (err) {
        console.log('[wxWorkApp] routePath URL 解析失败，将按普通路径处理:', s);
      }
    }

    if (!s.startsWith('/')) s = `/${s}`;
    s = s.replace(/\/+$/, '');
    return s || '/api/bot/wxWorkApp';
  }

  function pick(obj, keys) {
    if (!obj) return undefined;
    for (const key of keys) {
      if (obj[key] !== undefined) return Array.isArray(obj[key]) ? obj[key][0] : obj[key];
    }
    const lowerMap = Object.keys(obj).reduce((acc, key) => {
      acc[key.toLowerCase()] = key;
      return acc;
    }, {});
    for (const key of keys) {
      const realKey = lowerMap[key.toLowerCase()];
      if (realKey && obj[realKey] !== undefined) {
        return Array.isArray(obj[realKey]) ? obj[realKey][0] : obj[realKey];
      }
    }
    return undefined;
  }

  function makeSignature(token, timestamp, nonce, encrypted) {
    return crypto
      .createHash('sha1')
      .update([token, timestamp, nonce, encrypted].map(String).sort().join(''))
      .digest('hex');
  }

  function verifySignature(query, encrypted) {
    if (!cfg.enableSignatureCheck) return true;

    const msgSignature = query.msg_signature;
    const timestamp = query.timestamp;
    const nonce = query.nonce;
    if (!msgSignature || !timestamp || !nonce) throw new Error('缺少 msg_signature/timestamp/nonce');

    const expected = makeSignature(cfg.token, timestamp, nonce, encrypted);
    if (expected !== msgSignature) throw new Error('msg_signature 校验失败');
    return true;
  }

  function decryptWeCom(encrypted) {
    const aesKey = Buffer.from(`${cfg.encodingAESKey}=`, 'base64');
    if (aesKey.length !== 32) throw new Error('EncodingAESKey 非法，base64 解码后不是 32 字节');

    const iv = aesKey.slice(0, 16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', aesKey, iv);
    decipher.setAutoPadding(false);

    let decrypted = Buffer.concat([
      decipher.update(Buffer.from(String(encrypted), 'base64')),
      decipher.final(),
    ]);

    const pad = decrypted[decrypted.length - 1];
    if (pad < 1 || pad > 32) throw new Error('PKCS#7 padding 非法');
    decrypted = decrypted.slice(0, decrypted.length - pad);

    const msgLen = decrypted.readUInt32BE(16);
    const msg = decrypted.slice(20, 20 + msgLen).toString('utf8');
    const receiveId = decrypted.slice(20 + msgLen).toString('utf8');

    if (cfg.corpId && receiveId && receiveId !== cfg.corpId) {
      throw new Error(`receiveId 校验失败：${receiveId}`);
    }

    return msg;
  }

  function makeFallbackMsgId(msg) {
    const fromUser = pick(msg, ['FromUserName', 'fromusername']) || '';
    const createTime = pick(msg, ['CreateTime', 'createtime']) || Date.now();
    const msgType = pick(msg, ['MsgType', 'msgtype']) || '';
    return `${fromUser}-${createTime}-${msgType}`;
  }

  function isDuplicate(msgId) {
    if (!msgId) return false;
    if (seenMsgIds.has(msgId)) return true;
    seenMsgIds.set(msgId, Date.now());
    if (seenMsgIds.size > 2000) {
      const firstKey = seenMsgIds.keys().next().value;
      seenMsgIds.delete(firstKey);
    }
    return false;
  }

  function toBncrTextMessage(msg, msgType) {
    switch (msgType) {
      case 'text':
        return String(pick(msg, ['Content', 'content']) || '').trim();
      case 'image':
        return `[图片] ${pick(msg, ['PicUrl', 'picurl']) || pick(msg, ['MediaId', 'mediaid']) || ''}`.trim();
      case 'voice':
        return `[语音] ${pick(msg, ['MediaId', 'mediaid']) || ''}`.trim();
      case 'video':
        return `[视频] ${pick(msg, ['MediaId', 'mediaid']) || ''}`.trim();
      case 'file':
        return `[文件] ${pick(msg, ['Title', 'title']) || pick(msg, ['MediaId', 'mediaid']) || ''}`.trim();
      case 'location': {
        const x = pick(msg, ['Location_X', 'location_x']) || '';
        const y = pick(msg, ['Location_Y', 'location_y']) || '';
        const label = pick(msg, ['Label', 'label']) || '';
        return `[位置] ${label} ${x},${y}`.trim();
      }
      case 'event': {
        const event = pick(msg, ['Event', 'event']) || '';
        const eventKey = pick(msg, ['EventKey', 'eventkey']) || '';
        return `[事件] ${event}${eventKey ? ` ${eventKey}` : ''}`.trim();
      }
      default:
        return msgType ? `[${msgType}]` : '';
    }
  }

  async function buildSendBody(replyInfo) {
    const type = String(replyInfo.type || 'text').toLowerCase();
    const toUser = replyInfo.userId || replyInfo.toUser || replyInfo.touser;
    const toParty = replyInfo.partyId || replyInfo.toParty || replyInfo.toparty;
    const toTag = replyInfo.tagId || replyInfo.toTag || replyInfo.totag;

    if (!toUser && !toParty && !toTag) {
      throw new Error('缺少接收人：请传 userId/toUser、partyId/toParty 或 tagId/toTag');
    }

    const body = {
      agentid: await getAgentId(),
      safe: Number(replyInfo.safe || 0),
      enable_duplicate_check: Number(replyInfo.enableDuplicateCheck || 0),
      duplicate_check_interval: Number(replyInfo.duplicateCheckInterval || 1800),
    };

    if (toUser) body.touser = normalizeReceiver(toUser);
    if (toParty) body.toparty = normalizeReceiver(toParty);
    if (toTag) body.totag = normalizeReceiver(toTag);

    switch (type) {
      case 'markdown':
        body.msgtype = 'markdown';
        body.markdown = { content: String(replyInfo.msg || '') };
        break;
      case 'image':
        body.msgtype = 'image';
        body.image = { media_id: await uploadMedia(replyInfo.path || replyInfo.url || replyInfo.msg, 'image') };
        break;
      case 'voice':
      case 'audio':
        body.msgtype = 'voice';
        body.voice = { media_id: await uploadMedia(replyInfo.path || replyInfo.url || replyInfo.msg, 'voice') };
        break;
      case 'video':
        body.msgtype = 'video';
        body.video = {
          media_id: await uploadMedia(replyInfo.path || replyInfo.url || replyInfo.msg, 'video'),
          title: replyInfo.title || '',
          description: replyInfo.description || replyInfo.msg || '',
        };
        break;
      case 'file':
        body.msgtype = 'file';
        body.file = { media_id: await uploadMedia(replyInfo.path || replyInfo.url || replyInfo.msg, 'file') };
        break;
      case 'text':
      default:
        body.msgtype = 'text';
        body.text = { content: String(replyInfo.msg || '') };
        break;
    }

    return body;
  }

  function normalizeReceiver(value) {
    return Array.isArray(value) ? value.filter(Boolean).map(String).join('|') : String(value);
  }

  async function getAgentId() {
    const cached = await db.get('agentId', '');
    const agentId = cfg.agentId || cached;
    if (!agentId) throw new Error('未配置 AgentId');
    const num = Number(agentId);
    return Number.isFinite(num) ? num : agentId;
  }

  async function getAccessToken() {
    const exp = await db.get('accessTokenExp', 0);
    const cached = await db.get('accessToken', '');
    if (cached && exp && Number(exp) > Date.now()) return cached;

    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(cfg.corpId)}&corpsecret=${encodeURIComponent(cfg.corpSecret)}`;
    const json = await getJson(url);
    if (!json.access_token) throw new Error(`获取 access_token 失败：${JSON.stringify(json)}`);

    const expiresIn = Number(json.expires_in || 7200);
    const expTime = Date.now() + Math.max(expiresIn - 300, 60) * 1000;
    await db.set('accessToken', json.access_token);
    await db.set('accessTokenExp', expTime);
    return json.access_token;
  }

  function isAccessTokenError(json) {
    return json && [40001, 40014, 41001, 42001, 42007].includes(Number(json.errcode));
  }

  async function clearAccessTokenCache() {
    await db.del('accessToken');
    await db.del('accessTokenExp');
  }

  async function sendMsg(body, retryOnTokenError = true) {
    const accessToken = await getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

    debugLog('[wxWorkApp] 发送消息数据:', JSON.stringify(body));

    const json = await postJson(url, body);

    debugLog('[wxWorkApp] 发送响应:', JSON.stringify(json));

    if (json.errcode === 0) {
      if (json.invaliduser || json.invalidparty || json.invalidtag || json.unlicenseduser) {
        console.log('[wxWorkApp] 部分接收人不可达:', JSON.stringify(json));
      }
      return json.msgid || json.response_code || true;
    }

    if (retryOnTokenError && isAccessTokenError(json)) {
      console.log('[wxWorkApp] access_token 可能失效，清理缓存后重试一次:', JSON.stringify(json));
      await clearAccessTokenCache();
      return sendMsg(body, false);
    }

    throw new Error(`发送消息失败：${JSON.stringify(json)}`);
  }

  async function uploadMedia(mediaPath, mediaType) {
    if (!mediaPath) throw new Error(`发送 ${mediaType} 消息需要 path/url/msg 指向媒体文件`);

    const accessToken = await getAccessToken();
    const url = `https://qyapi.weixin.qq.com/cgi-bin/media/upload?access_token=${accessToken}&type=${mediaType}`;
    const form = new FormData();

    if (/^https?:\/\//i.test(String(mediaPath))) {
      const response = await got.get(mediaPath, { responseType: 'buffer' });
      let filename = 'media';
      try {
        filename = path.basename(new URL(mediaPath).pathname) || filename;
      } catch (_) {}
      form.append('media', response.body, { filename });
    } else {
      const filePath = path.resolve(String(mediaPath));
      if (!fs.existsSync(filePath)) throw new Error(`媒体文件不存在：${filePath}`);
      form.append('media', fs.createReadStream(filePath), { filename: path.basename(filePath) });
    }

    const response = await got.post(url, {
      body: form,
      headers: form.getHeaders(),
      responseType: 'json',
    });
    const json = response.body || response;
    if (json.errcode === 0 && json.media_id) return json.media_id;

    if (isAccessTokenError(json) && !uploadMedia._retried) {
      uploadMedia._retried = true;
      console.log('[wxWorkApp] 上传媒体时 access_token 可能失效，清理缓存后重试一次:', JSON.stringify(json));
      await clearAccessTokenCache();
      try {
        return await uploadMedia(mediaPath, mediaType);
      } finally {
        uploadMedia._retried = false;
      }
    }

    throw new Error(`上传媒体失败：${JSON.stringify(json)}`);
  }

  async function getJson(url) {
    const res = await got.get(url, { responseType: 'json' });
    return res.body || res;
  }

  async function postJson(url, body) {
    const res = await got.post(url, { json: body, responseType: 'json' });
    return res.body || res;
  }

  function flatten(arr) {
    return arr.reduce((out, item) => out.concat(Array.isArray(item) ? flatten(item) : item), []);
  }
};
