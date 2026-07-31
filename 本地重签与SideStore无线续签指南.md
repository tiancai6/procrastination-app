# 本地重签 + SideStore 无线续签 傻瓜指南

> 配套文件：`GitHubActions编译IPA完整方案.md`（云端出「未签名 IPA」）
> 本文件讲：拿到未签名 IPA 后，怎么在 **Windows 本地签名装到 iPhone**，以及怎么**以后不插线自动续签**。

---

## 总览（你最终要做 4 件事）

1. 从 GitHub Actions 下载「未签名 IPA」
2. Windows 上用 **Sideloadly** 用你的免费 Apple ID 签名、装到 iPhone（**这一次要插线**）
3. iPhone 上装 **SideStore**（也是这次插线装一次），之后它能**无线续签**
4. 设一个每周自动续签的定时任务（手机上一次设好，永远跑）

> ⚠️ 免费方案的铁律：**SideStore 本体首次安装必须插线一次**；之后所有续签、装新 App 都不插线。
> ⚠️ 免费证书 **7 天过期**，靠自动续签维持「永久可用」——不是真·永久，但按时续就一直能用。

---

## 第 1 步：下载未签名 IPA（电脑上）

1. 打开你的公开仓库（GitHub 网页）→ 顶部 **Actions** 标签
2. 点最新的那次运行（左边绿色对勾 ✅）
3. 页面最右侧 **Artifacts** → 下载 `unsigned-ipa`
4. 解压得到 `unsigned.ipa`，记住它在电脑上的位置（比如桌面）

---

## 第 2 步：Windows 装 Sideloadly

1. 浏览器打开 **sideloadly.io** → 下载 Windows 版安装
2. 打开 Sideloadly

---

## 第 3 步：Sideloadly 签名安装（插线一次）

1. iPhone 用数据线连电脑，手机上点「信任此电脑」
2. Sideloadly 里填：
   - **IPA**：选第 1 步的 `unsigned.ipa`
   - **Apple ID**：`你的免费 Apple ID（手机号或邮箱，建议备用号）`
   - **密码**：见下方「关于密码」⚠️
3. 点 **Start**
4. 手机桌面出现「拖延记录」= 装好了

### ⚠️ 关于密码（重要）
如果你的 Apple ID 开了**双重认证（2FA）**，Sideloadly **不能用登录密码**，要用「应用专用密码」：
- 电脑浏览器打开 **appleid.apple.com** → 登录 → 左侧「登录与安全」→「**应用专用密码**」
- 点「生成密码」，输个名字（比如 `sideloadly`），会得到一串 16 位字符
- 把那串填到 Sideloadly 的密码框

> 这一步装的 App，证书 **7 天过期**。过期后打开会闪退。要续签就再插线、打开 Sideloadly 点一次 Start。想**免去插线**，看第 4 步。

---

## 第 4 步：装 SideStore 实现无线续签（仅此一次还需电脑）

SideStore 本体也得先插线装一次，之后它就能无线续签你所有的侧载 App。

1. 电脑装 **iTunes**（微软商店版，用于手机和电脑通信）
2. 浏览器打开 **sidestore.io** → 下载 **SideStore 的 IPA**
3. 用**刚才的 Sideloadly** 把 SideStore 的 IPA 也装进手机（同样填 Apple ID + 应用专用密码）
4. 手机：设置 → 通用 → **VPN 与设备管理** → 找到你的 Apple ID → 点「**信任**」
5. 打开 **SideStore** → 登录你的 Apple ID（和上面同一个）
6. 接第 5 步装「回环 VPN」

---

## 第 5 步：回环 VPN（让 SideStore 能无线续签）

> 这是「本地隧道」，不是翻墙，只是让 SideStore 骗过 iOS 以为连着电脑。

1. **国区 App Store 搜不到**，需要注册一个**美区免费 Apple ID**（搜「美区 Apple ID 注册」教程，免费）
2. 在 iPhone 的 App Store 切到美区账号
3. 搜 **LocalDevVPN** 下载（如果你已装 **StikDebug**，可复用它的回环 VPN 配置，跳过这步）
4. 打开 LocalDevVPN → 连接，看到「已连接」即可

---

## 第 6 步：设置每周自动续签（手机，一次设好）

1. iPhone 设置 → 通用 → **后台 App 刷新** → 打开
2. 下载 SideStore 官方的 **Auto-Refresh** 快捷指令（或自建：连 VPN → 等 40 秒 → 断 VPN）
3. 打开 **快捷指令** App → **自动化** 标签 → 新建 → 选「时间」→ 设**每周一 10:00**
4. 添加「运行快捷指令」→ 选上面的 Auto-Refresh → **关掉「运行前询问」**

✅ 以后每周一自动：连 VPN → 刷新 SideStore 及所有侧载 App 证书 → 断 VPN，**全程不插线**。

---

## 常见坑

- **证书每 7 天过期**：自动续签让你无感。万一某周没续上（比如没开 Wi‑Fi），打开 SideStore 手动点「刷新」即可，仍不插线。
- **iPhone 重启后**：需手动开一次 SideStore（点一下刷新 / 或连 VPN 跑一次），才能恢复后台自动续签。
- **同时最多 3 个侧载 App**：你只装「拖延记录」一个，够用。
- **改了 App 代码**：重新跑 GitHub Actions 出包 → 下载新 IPA → 重新用 Sideloadly 装（第 3 步）。
- **iOS 大版本更新**可能破坏漏洞（尤其 SparseRestore/绕过 3 个上限），升级前先确认 SideStore 兼容性。

---

## 一句话流程

```
GitHub Actions 出 未签名 IPA
   → Sideloadly(插线) 签名装「拖延记录」+ 装 SideStore
      → 手机装回环 VPN
         → 快捷指令每周自动续签（此后零插线）
```
