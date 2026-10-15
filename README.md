# dsh-workbuddy-connect

把已登录的 **WorkBuddy / WorkBuddy AI**（国内版 / 国际版）桌面应用中可用的模型
接入 DeepSeek Harness，两个版本分别显示各自的模型分组，沿用各自的账号登录与积分。

> 个人自用分支。基于 MIT 许可的 `dsh-workbuddy-connect` 0.7.5 源码整理，
> 并做了本地化改造（见下方「与上游的差异」）。原作者版权声明保留在
> [`LICENSE`](./LICENSE)。

## 与上游的差异

| 项 | 说明 |
| --- | --- |
| **移除内置升级提醒** | 上游插件会主动请求其仓库的 npm dist-tags 与 GitHub releases，并在界面浮层里提示升级。本分支不需要该行为（升级节奏自行掌握），已整体移除：主机侧更新路由、浏览器侧浮层与缓存 store、以及相关文案。 |
| **内置登录与签到** | 新增 `login` / `checkin` 两个 CLI 子命令（见下），把原本需要独立脚本完成的「纯 HTTP 换明文凭据」和「每日签到」收进插件，并与插件共用同一份端点定义。 |

除上述改动外，插件行为与上游 0.7.5 保持一致。

## 功能

- **国内版与国际版并存**：国内版显示为「WorkBuddy」分组，国际版（WorkBuddy AI）显示为
  「WorkBuddy AI」分组；两版的模型、账号与积分互不混用，各自跟随对应 App 的登录状态。
  只登录一版就只出现一组，退出一版则对应分组消失。
- **图片输入**：多数模型支持在对话中直接粘贴或拖入图片；少数纯文本模型会明确提示不支持。
- **推理档位**：上游明确声明的档位直接显示；未声明的模型可在 Web / Desktop 的模型选择器里
  手动检测（会发送少量请求，可能消耗积分）。
- **余额速览**：选中模型时在输入框底部显示当前账号剩余积分，可点 ↻ 手动刷新。
- **信息与检测**：设置 → 插件 → 对应卡片可查看账号、令牌有效期、剩余积分与模型优惠，
  也可手动刷新模型列表、查看列表来源（实时 / 已保存 / 内置兜底）。
- **模型显隐**：卡片里可勾选要在选择器中显示的模型；隐藏配置按登录账号分别保存，
  切换账号自动切换，新账号与新上架模型默认显示。
- **企业账号积分**：国内版企业账号走企业计费接口读取周期额度与重置时间。
- **费率与徽章**：模型名后显示积分倍率（如 `x0.79`）；促销徽章（限时免费、夜间折扣）
  跟在模型名后，数据以服务端为准。

## 安装

插件以本地目录形式安装到 DSH 的 `desktop` profile。

```powershell
# 1. 构建产物（lib/ 已随仓库提交时，本步可跳过）
pnpm install
pnpm run build

# 2. 在 profile 里登记为本地依赖（link 指向本仓库）
#    $DSH_HOME 默认为 ~\.dsh
```

编辑 `$DSH_HOME\profiles\desktop\package.json`：

```json
{
  "dependencies": {
    "dsh-workbuddy-connect": "link:<本仓库绝对路径>"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "dsh-workbuddy-connect"
      ]
    }
  }
}
```

然后在 profile 目录执行 `pnpm install`，并**完全退出后重启 DSH** ——
provider 是在启动阶段通过 `cordis.patch.yml` 装配的，运行中的进程读不到改动。

**验证**：重启后模型选择器出现「WorkBuddy」/「WorkBuddy AI」分组，
从分组里选一个模型完成一次简短对话并能正常回复，即为成功。

### 前置条件

插件默认复用 WorkBuddy 桌面 App 的登录状态。若希望**脱离桌面端**，
可用明文凭据文件 + 环境变量（见下方「凭据」）。

## 凭据

凭据查找顺序：**环境变量 → 桌面端加密文件 → 插件自留副本**。

```
WORKBUDDY_AUTH_FILE     指向国内版明文凭据文件
WORKBUDDY_AI_AUTH_FILE  指向国际版明文凭据文件
```

明文凭据形状：

```json
{
  "auth": {
    "accessToken": "...",
    "refreshToken": "...",
    "expiresAt": 0,
    "refreshExpiresAt": 0,
    "domain": ""
  },
  "account": { "uid": "...", "nickname": "...", "enterpriseId": "..." }
}
```

其中 `domain` 决定区域：空字符串 = 国内版，`workbuddy.ai`（含子域）= 国际版。

> ⚠️ 桌面端的加密凭据文件**只要存在就优先于其他来源**，解不开时直接报错、不回退。
> 想彻底脱离桌面端，需要在确认新凭据可用后删除它。

⚠️ **凭据是敏感信息，不要提交进仓库，也不要外传。**

## 命令行

```sh
dsh-workbuddy-connect <checkin|doctor|login|logout|status> [options]
```

| 命令 | 作用 |
| --- | --- |
| `doctor` | 不含密钥的登录与环境诊断 |
| `status` | 登录状态、剩余积分、宿主 bundle 健康度 |
| `login` | 走纯 HTTPS 授权流程，写入**明文**凭据（不需要桌面端） |
| `checkin` | 查询每日签到状态；加 `--claim` 实际领取 |
| `logout` | 删除插件自留的凭据副本（不动桌面 App 自己的登录） |

公共选项：`--provider` 默认 `workbuddy`，可选 `workbuddy-ai`；`--json` 输出机器可读文档。
`login` 另接受 `--no-open`（只打印链接、不自动开浏览器），`checkin` 另接受 `--claim`。

### `login`：不依赖桌面端的登录

```sh
dsh-workbuddy-connect login --provider workbuddy
```

流程：申请 `state` → 打印授权链接（并尝试打开浏览器）→ 轮询换取令牌 → 拉账号资料 →
写明文凭据到 `$DSH_HOME/workbuddy-auth/`。

**为什么有用**：WorkBuddy 5.6 起把令牌加密落盘，密钥藏在改版 Electron 的私有 binding 里，
插件读桌面端文件时可能要把 App 的二进制当解密预言机拉起来。而登录本身只是普通 HTTPS，
所以在这里登录一次就能拿到明文凭据，之后**桌面端可以卸载**。

两处上游链接缺陷已在代码里修正（都不修正会让登录页报「登录链接不完整」）：

- 服务端下发的 `authUrl` 里 `platform` **恒为 `workbuddy`**，国际版必须改成 `workbuddy-ai`；
- `authUrl` 可能**缺 `state` / `version`**，缺失时登录页直接拒绝。

写完后按提示设置环境变量并重启 DSH：

```powershell
[Environment]::SetEnvironmentVariable('WORKBUDDY_AUTH_FILE', '<路径>\workbuddy-cn.json', 'User')
```

### `checkin`：每日签到

```sh
dsh-workbuddy-connect checkin              # 只读查询，无副作用
dsh-workbuddy-connect checkin --claim      # 未签则领取
```

⚠️ 签到接口的风控比聊天严，可能要求 `X-Device-Token`（腾讯 native TuringShield 指纹）。
该指纹无法在纯 JS 环境复刻，所以本命令**刻意不发**这个头 —— 这正是要测量的变量。
命令会把结果明确归类为「可用 / 被风控拒绝（401/403）/ 该平台没有签到活动」。

实测：**国内版有签到**，**国际版返回「活动未开启或已过期」**（两个平台 `code` 都是 `10001`
但含义不同，所以判定看文案而非 code）。

## 已知限制

- **依赖客户端私有接口**（非官方开放 API），WorkBuddy 更新后可能需要随之调整。
- **国际版模型目录来自 App 界面接口**，服务端按 User-Agent 分流下发，属私有实现；
  失效时按「上次成功目录 → 内置目录」降级，并在卡片标明来源。
- **推理档位**：对未声明档位的模型采用用户主动授权触发、动态获取的方式；
  一次请求成功并不证明某档位真实可用。
- **插件版本需与 DSH 内核匹配**，不匹配会导致 DSH 启动失败。
  本分支基于内核 `0.2.0-rc.2` 验证。
- ⚠️ **不要把 `@earendil-works/pi-ai` 升到 1.x**：本代内核与本插件都要求 `^0.87.1`；
  插件管理器的「可更新」提示不校验 peer 约束，不要照做。

## 许可

MIT，见 [`LICENSE`](./LICENSE)。本仓库不附带任何密钥或个人凭据。
