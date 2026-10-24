# FurryUP Live Assistant Core

不含内容的直播助手运行框架：接收事件，调用使用者提供的建议模块，管理提醒展示与反馈，并输出运行诊断。

由[夜霜（FrostyNight）](https://github.com/frostynight-furry)发起并维护，源自 [FurryUP Studio](https://frostynight.top/furryup) 的通用组件。

- **主播使用完整产品**：[了解 FurryUP Studio](https://frostynight.top/furryup) · [下载安装包](https://github.com/frostynight-furry/furryup-studio-releases)
- **开发者使用组件**：[快速体验](#快速体验) · [最小接入](#最小接入) · [API 文档](docs/API.md) · [English](README.en.md)

框架不包含课件、话术、提示词、运营策略、真实直播记录或内置模型服务。无需安装 FurryUP Studio、登录账号或连接直播平台，即可运行合成演示。

## 快速体验

需要 Node.js 22.12 或更新版本，无需安装依赖。

```sh
node examples/replay.cjs
node examples/replay.cjs --realtime
node examples/server.cjs
```

`--realtime` 回放展示状态刷新、过时结果撤销和预算预扣。最后一条命令会显示本机演示地址。在浏览器打开该地址，可以测试事件输入、观察、上下文更新、提醒排队、暂停、反馈、过期和会话切换。服务只监听 `127.0.0.1`；演示数据均为合成。

## 最小接入

```js
const { createAssistantRuntime } = require('./core/index.cjs');
const runtime = createAssistantRuntime({
  provider: async (context, { signal }) => ({ mode: 'observe' })
});
runtime.start('demo-session');
runtime.ingest({ id: 'demo-1', scope: 'demo-session', type: 'sample', at: Date.now(), data: {} });
runtime.evaluate().then(result => console.log(result.status));
```

`ingest` 本身不调用模型。显式调用 `evaluate` 才会请求提供器。提供器由使用者实现，可返回 `observe`、`remember` 或 `suggest`；框架不会自动发弹幕、操作 OBS 或执行模型返回的动作。

## 能力与边界

- 会话隔离、有限去重、上下文快照、超时取消和迟到结果撤销。
- 提醒优先级、稳定展示、暂停待显示提醒、过期及采纳/拒绝记录。
- 可注入展示时长和紧急度计算，不捆绑业务参数。
- LiveConnect v1 信封适配；默认不传递弹幕正文、用户身份或原始扩展字段。
- 诊断只保留状态及标识哈希，不保存提示词、消息正文、模型输出或错误原文。
- 实时状态来源、时间和新鲜度；按依赖键检查上下文版本，丢弃过期分析结果。
- 显式配置的滚动请求预算与可保存的预扣记录；可选单飞分析协调器，无自动重试。

提供器属于使用者信任的本地代码，不是安全沙箱。默认仅内存存储，重启后不恢复队列。去重与历史记录均有容量/时间边界，不承诺永久恰好一次。建议质量取决于使用者接入的内容和服务。

[API 与集成](docs/API.md) · [边界与验证](docs/BOUNDARIES.md) · [调研与复用](docs/RESEARCH.md) · [English](README.en.md)

## 检查与打包

```sh
node scripts/verify.cjs
node scripts/archive.cjs ../assistant-core-0.2.0.tar
```

打包使用系统 `tar`，逐项核对实际归档文件与已审查源文件的 SHA-256。源码白名单和通用敏感信息检查可公开运行；维护者还须在私有环境中对实际归档执行内容参考库检查。通用检查通过不代表已完成私有内容审查。

源码采用 MIT 许可，公开仓库为 [frostynight-furry/furryup-live-assistant-core](https://github.com/frostynight-furry/furryup-live-assistant-core)。`private: true` 阻止误发布到 npm；CI 仅运行检查，不执行自动发布。

## 关于夜霜与 FurryUP Studio

[夜霜（FrostyNight）](https://github.com/frostynight-furry)是本项目的发起者与维护者。[FurryUP Studio](https://frostynight.top/furryup) 是面向主播的桌面产品，通过统一界面组织直播工作流，并提供安装和更新体验；安装包与发行说明见[下载仓库](https://github.com/frostynight-furry/furryup-studio-releases)。

本仓库发布可独立集成的通用助手框架，不包含完整 FurryUP Studio 产品。使用组件无需安装或登录完整产品；内容、模型服务与业务策略由集成方提供。

## 自愿致谢

欢迎在项目 README、文档或“关于”页提及所使用的组件及维护者。可复制以下示例：

```markdown
本项目使用 [FurryUP Live Assistant Core](https://github.com/frostynight-furry/furryup-live-assistant-core)。该组件由[夜霜（FrostyNight）](https://github.com/frostynight-furry)发起并维护，源自 [FurryUP Studio](https://frostynight.top/furryup)。
```

```markdown
This project uses [FurryUP Live Assistant Core](https://github.com/frostynight-furry/furryup-live-assistant-core), initiated and maintained by [FrostyNight (夜霜)](https://github.com/frostynight-furry). This component originated in [FurryUP Studio](https://frostynight.top/furryup).
```

上述致谢和链接完全自愿，不增加任何 MIT 许可条件。MIT 对版权声明及许可声明的保留要求仍然有效，详见 [LICENSE](LICENSE)。致谢不表示夜霜或 FurryUP Studio 对衍生项目、产品或服务的官方背书。
