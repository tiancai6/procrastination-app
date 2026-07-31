# GitHub Actions 编译「未签名 IPA」完整方案（公开仓库 · 无限免费）

> 前提：你的代码**可以公开**。公开仓库的 GitHub Actions 提供**无限免费 macOS 构建时长**（标准 runner），且无需绑卡。
> 目标不变：云端 Mac 编译出**未签名 IPA** → 下载 → Windows 上 Sideloadly 用免费 Apple ID 重签自测（7 天一续，零付费）。

---

## 0. 为什么选 GitHub Actions（公开仓库）

| 对比项 | Codemagic 免费档 | **GitHub Actions（公开仓库）** |
|---|---|---|
| macOS 时长 | 500 分钟/月 | **无限**（fair-use，个人自测不会触发限制） |
| 是否需要绑卡 | 通常需要（验证） | **不需要** |
| 仓库是否公开 | 私库也可 | **必须公开** |
| 产物下载 | Codemagic Artifacts | GitHub Actions Artifacts（保留 90 天，单仓库 500MB 免费额度） |

> 结论：既然代码能公开，GitHub Actions 是更省心、更无限的选择。

---

## 1. 前置准备（每一步具体怎么做）

> 下面每一项都要完成；做完可对照文末 checklist 自查。

### 1.1 准备 GitHub 账号
1. 打开 [github.com](https://github.com)，点 **Sign up** 用邮箱注册（已有则跳过）。
2. 建议开启双重认证：**Settings → Password and authentication → Two-factor authentication**，提升账号安全。

### 1.2 新建一个「公开」仓库
1. 登录后点右上角 **+ → New repository**。
2. **Repository name** 填项目名（如 `my-ios-app`）。
3. **Visibility 必须选 Public（公开）**——这是走「无限免费 macOS 构建」的关键，选 Private 就只剩 ~200 分钟/月。
4. 可勾选 **Add a README file**（方便有初始提交），其余默认，点 **Create repository**。

### 1.3 本地安装 Git（Windows）
1. 下载 [git-scm.com](https://git-scm.com) 的 Windows 版，一路下一步安装。
2. 验证：打开 PowerShell 或 Git Bash，输入 `git --version` 能看到版本号即成功。
3. 配置提交身份（只需一次）：
   ```bash
   git config --global user.name "你的名字"
   git config --global user.email "你的GitHub邮箱"
   ```
4. 配置凭证（避免每次输密码）：GitHub 现在用 **Personal Access Token (PAT)** 而非账号密码登录 Git。
   - 推荐装 GitHub CLI：`winget install gh`，然后 `gh auth login` 按提示登录；
   - 或安装 Git 时默认勾选的 **Git Credential Manager**，首次输一次 PAT 后会记住。
   - 生成 PAT：GitHub **Settings → Developer settings → Personal access tokens → Tokens (classic)**，勾 `repo` 权限，生成后复制保存（只显示一次）。

### 1.4 把代码推到 GitHub
**情况 A：本地还没有 git 仓库**
```bash
cd 你的项目目录
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```
**情况 B：本地已有 git 仓库，只差连远程**
```bash
git remote add origin https://github.com/你的用户名/你的仓库名.git
git push -u origin main
```
> 推送后到 GitHub 仓库页面刷新，能看到代码即成功。

### 1.5 准备一个免费 Apple ID
1. 用你已有的 Apple ID 即可（就是 iPhone 上登录的那个）。若想用**备用号**：在 iPhone「**设置 → 登录 iPhone**」注册一个新的。
2. **必须开启双重认证**：iPhone「设置 → 点顶部你的名字 → 登录与安全性 → 双重认证」打开，否则 Sideloadly / AltStore 签名会失败。
3. 记下这个 Apple ID 和密码——后面 Sideloadly 重签要用。
4. ⚠️ 建议用**备用 Apple ID**（不是 iCloud 主力账号）。免费自签完全合规、不会被封，但密码会暂存在本地签名工具里，备用号更安心。

### 1.6 Windows 端准备安装工具（Sideloadly + iTunes / iCloud）
1. 下载 **Sideloadly**：[sideloadly.io](https://sideloadly.io) 的 Windows 版（免费）。
2. 下载**苹果官网版** iTunes 与 iCloud：
   - 必须去苹果官网下载 `.exe` 安装包，**不要从 Microsoft Store 安装**——Store 版缺 Wi-Fi 同步组件，Sideloadly 会识别不了设备。
   - iTunes：[apple.com/itunes/download](https://www.apple.com/itunes/download/) ；iCloud：苹果官网搜索 "iCloud for Windows"。
3. 安装完成后**重启电脑**；用 USB 线连 iPhone，手机弹窗点「信任此电脑」，iTunes 里也点信任。

### 1.7 确认代码完整性（无需 Mac）
- 你**不需要 Mac** 来验证构建，CI 会替你编译。只要确保：
  - 项目代码完整（如 Flutter 需含 `pubspec.yaml`、`lib/`、`ios/`；RN 需含 `package.json`、`ios/`）；
  - 能正常 `git push` 到公开仓库。
- 若本地有 Mac 想先验证，可在 Mac 上跑对应构建命令；没有则直接交给 GitHub Actions。

### ✅ 前置准备自查清单
- [ ] 有 GitHub 账号，且新建了 **Public** 仓库
- [ ] 本地装好 Git，且 `git push` 能把代码推上去
- [ ] 有一个开启**双重认证**的免费 Apple ID（建议备用号）
- [ ] Windows 装好 **Sideloadly + 官网版 iTunes/iCloud**，iPhone 已信任电脑
- [ ] 项目代码完整，可正常推送

---

## 2. 放置工作流文件

在仓库根目录创建文件夹与文件：`.github/workflows/build-ipa.yml`
把下面**对应你框架**的内容粘进去，然后 `git push`。

### 2.1 Flutter（最推荐，跨平台首选）

```yaml
name: Build Unsigned IPA

on:
  push:
    branches: [main]          # 改成你的主分支名
  workflow_dispatch:          # 允许在 Actions 页面手动触发

jobs:
  build-ios:
    runs-on: macos-latest     # 公开仓库免费，无需 10x 扣额度
    steps:
      - name: 拉取代码
        uses: actions/checkout@v4

      - name: 安装 Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.24.3'   # 改成你项目用的版本，或写 stable
          channel: stable

      - name: 清理缓存
        run: flutter clean

      - name: 拉取 Dart 依赖
        run: flutter pub get

      - name: 安装 iOS 原生依赖 (CocoaPods)
        run: |
          cd ios
          pod install
          cd ..

      - name: 构建未签名 IPA（核心：--no-codesign）
        run: flutter build ipa --no-codesign --release

      - name: 上传 IPA 产物
        uses: actions/upload-artifact@v4
        with:
          name: unsigned-ipa
          path: build/ios/ipa/*.ipa
```

产物：`build/ios/ipa/Runner.ipa`（文件名取项目名）。

### 2.2 React Native（iOS）

```yaml
name: Build Unsigned IPA (RN)

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: 安装 Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: 安装 JS 依赖
        run: npm install        # 或 yarn install

      - name: 安装 iOS 原生依赖
        run: |
          cd ios
          pod install --repo-update
          cd ..

      - name: 归档（关闭签名）
        run: |
          cd ios
          xcodebuild -workspace Runner.xcworkspace \
            -scheme Runner -configuration Release -sdk iphoneos \
            -archivePath build/Runner.xcarchive \
            archive CODE_SIGNING_ALLOWED=NO

      - name: 导出未签名 IPA
        run: |
          cd ios
          xcodebuild -exportArchive \
            -archivePath build/Runner.xcarchive \
            -exportOptionsPlist exportOptions.plist \
            -exportPath build/ipa

      - name: 上传 IPA 产物
        uses: actions/upload-artifact@v4
        with:
          name: unsigned-ipa
          path: build/ipa/*.ipa
```

同仓库放 `ios/exportOptions.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>method</key>
  <string>development</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
```

### 2.3 原生 Xcode / Swift / Obj-C

```yaml
name: Build Unsigned IPA (Native)

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  build-ios:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - name: 归档（关闭签名）
        run: |
          xcodebuild -workspace MyApp.xcworkspace -scheme MyApp \
            -configuration Release -sdk iphoneos \
            -archivePath build/MyApp.xcarchive \
            archive CODE_SIGNING_ALLOWED=NO

      - name: 导出未签名 IPA
        run: |
          xcodebuild -exportArchive \
            -archivePath build/MyApp.xcarchive \
            -exportOptionsPlist exportOptions.plist \
            -exportPath build/ipa

      - name: 上传 IPA 产物
        uses: actions/upload-artifact@v4
        with:
          name: unsigned-ipa
          path: build/ipa/*.ipa
```

`exportOptions.plist` 同 2.2（method=development，不填证书）。

---

## 3. 触发与下载

1. 把 `build-ipa.yml` 推送到公开仓库。
2. 进入仓库 **Actions** 页 → 看到 `Build Unsigned IPA` 工作流 → 自动运行（或在页面点 **Run workflow** 手动触发）。
3. 等待构建（Flutter 约 5–10 分钟）。绿色对勾后，点进该次运行 → 底部 **Artifacts** → 下载 `unsigned-ipa`（里面是 `*.ipa`）。
4. 该 IPA 是**未签名**的，需本地重签后才能装。

> 产物默认保留 **90 天**；单仓库 GitHub Packages/Artifacts 免费额度 500MB，一个 IPA 通常几十 MB，完全够用。

---

## 4. 回到 Windows 重签自测（承接上一步）

1. 打开 **Sideloadly**，把下载的 IPA 拖进去，填**免费 Apple ID** 与密码。
2. 点 Start，等待装到 iPhone。
3. 手机：`设置 → 通用 → VPN与设备管理`，信任你的 Apple ID 描述文件。
4. App 即可打开，有效期 **7 天**。
5. 续期：7 天后用**同一 Apple ID + 同一包名**再侧载一次即可（建议备份 App 内数据）。

---

## 5. 常见坑与排查

| 现象 | 原因 / 解决 |
|---|---|
| `pod: command not found` | macOS runner 一般自带 CocoaPods；若缺失，在步骤里加 `sudo gem install cocoapods` |
| Flutter 版本报错 / 插件不兼容 | 把 `flutter-version` 固定成你本地成功的版本号，别用 `stable` 漂移 |
| `xcodebuild` 要求签名 | 确认加了 `CODE_SIGNING_ALLOWED=NO`；Xcode 工程 Signing 设了 Auto 也会尝试签，该参数可强制跳过 |
| IPA 下载后 Sideloadly 报"已签名/无效" | CI 实际签了名；检查是否误配证书，或去掉 `--release` 改手写 archive |
| Firebase / 原生 SDK 报错 | 多在 `pod install` 阶段拉取，确保网络可访问且 CocoaPods 已装 |
| 想免电脑续期 | 首次装好 **SideStore**（AltStore 衍生版），之后靠 Wi-Fi 在手机上自行刷新 |

---

## 6. 一句话流程

```
Windows 改代码 → git push（公开仓库）
  → GitHub Actions 云端 Mac 编译(--no-codesign) → 下载未签名 IPA
  → Windows Sideloadly 用免费 Apple ID 重签 → iPhone 自测 7 天
```

> 注：公开仓库意味着代码对所有人可见。若以后代码变私密，再切回 Codemagic 免费档（500 分钟/月）即可，构建配置基本通用。
