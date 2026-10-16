// Synthetic screenshots for manual schedule-recognition testing. No real user data.
import { chromium } from '@playwright/test';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

const output = new globalThis.URL('.', import.meta.url).pathname;
const cases = [
  {
    id: '01-wechat-tomorrow', app: 'wechat', room: '林娜', date: '2026年9月18日 星期五',
    messages: [
      { from: '林娜', time: '09:12', text: '合同初稿我看过了，见面聊比较快。' },
      { from: '林娜', time: '09:13', text: '明天上午10点到11点，在梧桐路18号的青山咖啡馆见，我们一起过一下合同初稿。' },
      { from: '我', time: '09:14', text: '收到。' }
    ]
  },
  {
    id: '02-feishu-two-kinds', app: 'feishu', room: '移动端项目组', date: '2026年9月18日 星期五',
    messages: [
      { from: '小周', time: '10:03', text: '下周二（9月22日）18:00前，把移动端原型提交给我。' },
      { from: '阿宁', time: '10:05', text: '下周三（9月23日）15:30—16:30在3A会议室做原型评审，参会是小周、阿宁和你。' },
      { from: '我', time: '10:06', text: '我先把安排记下来。' }
    ]
  },
  {
    id: '03-dingtalk-deadlines', app: 'dingtalk', room: '预算协作群', date: '2026年9月18日 星期五',
    messages: [
      { from: '李工', time: '11:28', text: '9月28日先核对完数据。9月30日之前把Q4预算方案提交给财务，最晚18:00。' },
      { from: '我', time: '11:30', text: '收到，两个节点我分别记录。' }
    ]
  },
  {
    id: '04-mail-timezone', app: 'mail', room: 'Project review — Los Angeles',
    sender: 'Morgan Lee <morgan@example.test>', to: 'me@example.test', date: '2026年9月18日 08:25',
    paragraphs: [
      'Hi,',
      'Our project review is on Thursday, September 24, 2026, from 09:00 to 10:00 PDT (Los Angeles time).',
      'The video link will be sent later. Please join remotely.',
      'Best, Morgan'
    ]
  },
  {
    id: '05-wechat-old-message', app: 'wechat', room: '客户交接', date: '2026年9月14日 星期一',
    messages: [
      { from: '王敏', time: '16:42', text: '明天09:00—09:30在4楼小会议室交接客户资料，麻烦你带上合同。' },
      { from: '我', time: '16:43', text: '好的，明天见。' }
    ]
  },
  {
    id: '06-feishu-reschedule', app: 'feishu', room: '产品例会', date: '2026年9月18日 星期五',
    messages: [
      { from: '主持人', time: '09:08', text: '原定今天14:00的产品例会取消，改到下周三（9月23日）15:00—16:00，地点仍为3A会议室。' },
      { from: '主持人', time: '09:09', text: '请大家更新原日程，不要再新建一个重复会议。' }
    ]
  },
  {
    id: '07-dingtalk-uncertain', app: 'dingtalk', room: '供应商沟通', date: '2026年9月18日 星期五',
    messages: [
      { from: '采购同事', time: '17:02', text: '下周找时间和供应商聊一下，老地方，应该是下午吧。具体哪天、几点，等我确认再通知。' },
      { from: '我', time: '17:04', text: '好，等你确认具体时间。' }
    ]
  },
  {
    id: '08-mail-conflicting-weekday', app: 'mail', room: '运营培训时间确认',
    sender: '培训组 <training@example.test>', to: 'me@example.test', date: '2026年9月18日 12:40',
    paragraphs: [
      '你好，',
      '运营培训定在2026年9月24日（周五）下午3点至4点，地点为B201培训室。',
      '麻烦收到后确认，日历时间以我们后续确认的通知为准。'
    ]
  },
  {
    id: '09-wechat-no-event', app: 'wechat', room: '周末闲聊', date: '2026年9月18日 星期五',
    messages: [
      { from: '阿杰', time: '20:12', text: '明天有空吗？有空再说吧，暂时不用约时间。' },
      { from: '我', time: '20:13', text: '好，之后再联系。' }
    ]
  },
  {
    id: '10-dingtalk-cross-year', app: 'dingtalk', room: '研发值班群', date: '2026年12月31日 星期四',
    messages: [
      { from: '值班负责人', time: '18:20', text: '明天上午9点到10点，在研发楼2楼会议室做新年值班交接。' },
      { from: '我', time: '18:22', text: '收到。' }
    ]
  },
  {
    id: '11-feishu-multi-day', app: 'feishu', room: '市场活动群', date: '2026年9月18日 星期五',
    messages: [
      { from: '活动负责人', time: '14:00', text: '10月1日至10月3日全天在广州出差参加展会；9月29日18:00前订好车票。' },
      { from: '活动负责人', time: '14:01', text: '展会地点是琶洲会展中心，车票订好后发我就行。' }
    ]
  }
];

function escape(text) {
  return String(text).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
}

function browserExecutable() {
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  if (!existsSync(cache)) return undefined;
  for (const directory of readdirSync(cache).filter((name) => name.startsWith('chromium_headless_shell-')).sort().reverse()) {
    const executable = join(cache, directory, 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
    if (existsSync(executable)) return executable;
  }
  return undefined;
}

function renderChat(fixture) {
  const isWeChat = fixture.app === 'wechat';
  const isFeishu = fixture.app === 'feishu';
  const product = isWeChat ? '微信' : isFeishu ? '飞书' : '钉钉';
  const entries = fixture.messages.map((message) => `
    <div class="message ${message.from === '我' ? 'mine' : ''}">
      <div class="avatar">${escape(message.from.slice(0, 1))}</div>
      <div class="message-main"><div class="who">${escape(message.from)} <span>${escape(message.time)}</span></div>
      <div class="bubble">${escape(message.text)}</div></div>
    </div>`).join('');
  return `<div class="app ${fixture.app}">
    <aside class="rail"><div class="rail-logo">${isWeChat ? '微' : isFeishu ? '✦' : '钉'}</div><div class="rail-icon active">▤</div><div class="rail-icon">◫</div><div class="rail-icon">▦</div><div class="rail-icon">◎</div><div class="rail-bottom">我</div></aside>
    <aside class="rooms"><div class="search">⌕ &nbsp;搜索</div><div class="rooms-title">消息 <span>＋</span></div>
      <div class="room selected"><div class="room-avatar">${escape(fixture.room.slice(0, 1))}</div><div><strong>${escape(fixture.room)}</strong><small>${escape(fixture.date.split(' ')[0])} · ${escape(fixture.messages[0].text.slice(0, 12))}…</small></div></div>
      <div class="room"><div class="room-avatar muted">文</div><div><strong>文档协作</strong><small>资料已收到</small></div></div>
      <div class="room"><div class="room-avatar muted">工</div><div><strong>工作群</strong><small>谢谢，辛苦了</small></div></div>
      <div class="room"><div class="room-avatar muted">联</div><div><strong>联系人</strong><small>点击查看消息</small></div></div>
    </aside>
    <main class="chat"><header class="chat-head"><div><strong>${escape(fixture.room)}</strong><small>${product} · 合成测试对话</small></div><span>⌕ &nbsp; ⋯</span></header>
      <div class="chat-body"><div class="date-pill">${escape(fixture.date)}</div>${entries}</div>
      <div class="composer"><div class="composer-tools">☺ &nbsp; ▣ &nbsp; ✂ &nbsp; ▤</div><div class="composer-hint">发送消息…</div><div class="send">发送</div></div>
    </main>
    <aside class="info"><strong>会话信息</strong><div class="info-card">${escape(fixture.room)}</div><p>聊天记录</p><p>群文件</p><p>共同文档</p></aside>
  </div>`;
}

function renderMail(fixture) {
  return `<div class="app mail"><div class="mail-top"><div class="mail-mark">M</div><strong>邮箱</strong><div class="mail-search">⌕ &nbsp;搜索邮件</div><div class="mail-user">我</div></div>
    <div class="mail-content"><aside class="mail-menu"><div class="compose">＋ &nbsp; 写邮件</div><div class="folder current">▣ &nbsp; 收件箱 <b>2</b></div><div class="folder">☆ &nbsp; 星标邮件</div><div class="folder">◷ &nbsp; 稍后处理</div><div class="folder">▤ &nbsp; 已发送</div><div class="folder">▥ &nbsp; 草稿箱</div></aside>
    <main class="letter"><div class="letter-toolbar">← &nbsp;&nbsp; ▢ &nbsp;&nbsp; ◫ &nbsp;&nbsp; ⋯ <span>打印 &nbsp; ↗</span></div>
      <div class="letter-inner"><h1>${escape(fixture.room)}</h1><div class="sender"><div class="sender-avatar">${escape(fixture.sender.slice(0, 1))}</div><div><strong>${escape(fixture.sender)}</strong><small>收件人：${escape(fixture.to)}</small></div><time>${escape(fixture.date)}</time></div>
      <div class="letter-body">${fixture.paragraphs.map((paragraph) => `<p>${escape(paragraph)}</p>`).join('')}</div>
      <div class="reply">↩ &nbsp;回复</div></div>
    </main></div></div>`;
}

function html(fixture) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;color:#263241;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB",Arial,sans-serif;background:#e7eaf0;font-size:17px}
    .desktop{width:1280px;height:780px;padding:24px;background:linear-gradient(135deg,#e3e9f0,#f5f6f9)}
    .app{height:732px;display:flex;overflow:hidden;border-radius:13px;box-shadow:0 20px 65px #4e627042;background:white}
    .rail{width:70px;background:#28333d;color:#b6c1c9;display:flex;flex-direction:column;align-items:center;padding:24px 0;gap:24px}
    .rail-logo{background:#45bd72;color:white;border-radius:12px;width:39px;height:39px;display:grid;place-items:center;font-weight:700}
    .rail-icon{font-size:25px;width:42px;height:40px;text-align:center;line-height:40px}.rail-icon.active{color:#51d388}.rail-bottom{margin-top:auto;border-radius:50%;background:#a1adb5;color:white;width:34px;height:34px;display:grid;place-items:center}
    .rooms{width:276px;background:#f6f7f9;border-right:1px solid #e8eaf0}.search{height:40px;margin:22px 16px 20px;padding:8px 13px;background:#e9ecf0;border-radius:8px;color:#9ba4ac;font-size:14px}
    .rooms-title{padding:0 19px 17px;font-weight:700;font-size:20px}.rooms-title span{float:right;color:#8a949e}.room{display:flex;align-items:center;gap:10px;padding:17px 12px;height:78px}.room.selected{background:#e4e8eb}.room-avatar{background:#75abd9;color:white;min-width:43px;height:43px;display:grid;place-items:center;border-radius:7px}.room-avatar.muted{background:#b8c4cf}
    .room strong,.room small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:175px}.room strong{font-size:15px}.room small{font-size:12px;margin-top:6px;color:#929da8}
    .chat{flex:1;display:flex;flex-direction:column;background:#f4f6f8}.chat-head{height:75px;display:flex;align-items:center;justify-content:space-between;padding:0 28px;border-bottom:1px solid #e4e7ea;background:#fbfcfd}
    .chat-head strong{font-size:19px}.chat-head small{display:block;color:#9ca5b1;font-size:12px;margin-top:5px}.chat-head>span{color:#8d9ba9;font-size:21px}.chat-body{flex:1;overflow:hidden;padding:24px 33px}.date-pill{width:max-content;margin:0 auto 25px;background:#e5e9ed;color:#6f7d8a;padding:8px 17px;border-radius:20px;font-size:14px;font-weight:600}
    .message{display:flex;align-items:start;gap:12px;margin-bottom:29px;max-width:690px}.avatar{width:38px;height:38px;display:grid;place-items:center;flex:none;background:#788cc2;color:white;border-radius:8px;font-size:15px}.message-main{min-width:0}.who{color:#647182;font-size:13px;margin:0 0 7px}.who span{padding-left:7px;color:#a0abb7}
    .bubble{background:white;border:1px solid #e7eaf0;border-radius:5px 13px 13px 13px;padding:14px 18px;line-height:1.75;font-size:19px;letter-spacing:.1px;box-shadow:0 2px 9px #8c9aa012}
    .mine{margin-left:auto;flex-direction:row-reverse}.mine .who{text-align:right}.mine .avatar{background:#6699bf}.mine .bubble{background:#cef1cc;border-color:#c8e8c7;border-radius:13px 5px 13px 13px}
    .composer{height:135px;border-top:1px solid #e5e8ed;background:white;padding:14px 24px}.composer-tools{font-size:21px;color:#8f9cab}.composer-hint{margin-top:15px;color:#c2c8d0;font-size:15px}.send{float:right;padding:7px 20px;background:#e7ecef;color:#8d9aa2;border-radius:6px;font-size:13px}
    .info{width:145px;padding:30px 18px;border-left:1px solid #e7eaee;background:#fbfcfd;color:#7b8793;font-size:14px}.info strong{color:#354153}.info-card{margin:25px 0 30px;border:1px solid #e6eaf0;padding:12px 6px;text-align:center;border-radius:8px;font-size:13px}.info p{padding:8px 0;border-bottom:1px solid #eceef0}
    .feishu .rail{background:#132b53}.feishu .rail-logo{background:#405de6}.feishu .rail-icon.active{color:#86a2ff}.feishu .room.selected{background:#eaf0ff}.feishu .bubble{border-radius:12px}.feishu .mine .bubble{background:#e7edff;border-color:#dbe3ff}
    .dingtalk .rail{background:#0a70cf}.dingtalk .rail-logo{background:white;color:#1685ee}.dingtalk .rail-icon.active{color:white}.dingtalk .room.selected{background:#e7f3ff}.dingtalk .chat{background:#f0f6fd}.dingtalk .mine .bubble{background:#ddecff;border-color:#ccdef5}
    .mail{display:block}.mail-top{height:72px;background:#f7f8fc;display:flex;align-items:center;padding:0 28px;gap:15px}.mail-mark{font-size:27px;color:#dc5960;font-weight:bold}.mail-top strong{font-size:22px;color:#4d5662}.mail-search{margin-left:96px;background:#eaf0f7;color:#7a8b9d;padding:13px 20px;border-radius:24px;width:540px;font-size:15px}.mail-user{margin-left:auto;border-radius:50%;background:#a9b4e8;color:white;width:37px;height:37px;display:grid;place-items:center}.mail-content{height:660px;display:flex;background:#f6f8fb}.mail-menu{width:250px;padding:26px 16px}.compose{background:#d8e7ff;border-radius:15px;padding:16px;margin:0 14px 25px;width:145px}.folder{padding:13px 20px;font-size:15px;color:#576574}.folder.current{background:#dce9fa;border-radius:20px;color:#294f7d;font-weight:700}.folder b{float:right}.letter{background:white;margin:12px 16px 13px 0;flex:1;border-radius:14px;overflow:hidden}.letter-toolbar{padding:21px 38px;color:#768493;border-bottom:1px solid #e9edf2}.letter-toolbar span{float:right}.letter-inner{padding:30px 50px}.letter h1{font-size:25px;font-weight:650;margin:0 0 30px}.sender{display:flex;align-items:center;gap:13px}.sender-avatar{width:43px;height:43px;background:#779bd7;color:white;display:grid;place-items:center;border-radius:50%}.sender strong{font-size:16px}.sender small{display:block;font-size:13px;color:#7c8793;margin-top:5px}.sender time{margin-left:auto;color:#7d8b99;font-size:13px}.letter-body{font-size:21px;line-height:1.8;margin:45px 6px 25px;max-width:750px}.letter-body p{margin:0 0 22px}.reply{margin-top:28px;border:1px solid #cdd5df;border-radius:22px;padding:12px 22px;display:inline-block;color:#556479;font-size:14px}
  </style></head><body><div class="desktop">${fixture.app === 'mail' ? renderMail(fixture) : renderChat(fixture)}</div></body></html>`;
}

async function main() {
  mkdirSync(output, { recursive: true });
  const executablePath = browserExecutable();
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 780 }, deviceScaleFactor: 1 });
    for (const fixture of cases) {
      await page.setContent(html(fixture), { waitUntil: 'load' });
      await page.evaluate('document.fonts.ready');
      await page.screenshot({ path: join(output, `${fixture.id}.png`) });
      process.stdout.write(`${fixture.id}.png\n`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => { globalThis.console.error(error); process.exitCode = 1; });
