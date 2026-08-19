# AIMangaStudio 项目文档

本目录存放项目的设计文档与参考资产。

## 📁 references/ — 视觉 DNA 参考图

**目的**：永久保存"我们项目的目标画风长什么样"，供你和 AI 随时对照。

文件：

- `01-two-shot-coffee-shop.png` — 两人对话场景（最常用）
- `02-over-shoulder-silence.png` — 客厅远景人物背影
- `03-detail-empty-coffee.png` — 空镜特写（无人场景）

这些图都是用 `server/graphic-novel-dna.ts` 中 v1.0-locked 的 IMAGE_SYSTEM_PROMPT 生成的。

**何时刷新**：

- 修改了 `server/graphic-novel-dna.ts` 后，建议重新生成参考图。
- 重新生成方法：`node tools/regen-dna-reference.cjs`

---

## 📁 style-dna.md — 视觉 DNA 规范（文档版）

这是用户（导演）撰写的完整 Art Direction 规范文档：

→ 核心约束**已经编码**到 `server/graphic-novel-dna.ts`。
→ 本文档是它的"人类可读版"，用来回顾设计意图。

---

## 🛠️ tools/ — 一次性辅助脚本

`regen-dna-reference.cjs` —— 重新生成 references/ 下的 3 张参考图。

需要 Agnes API key（已硬编码）。如果 Agnes 升级或换 provider，需要改里面的 endpoint。

---

## 🚀 一键启动（全程零终端）

详见根目录的 `start.bat` / `start.ps1` / `stop.bat`：

**默认行为**：双击 `start.bat` → **什么窗口都不弹**（连闪一下都没有），1 秒后浏览器自动打开。

**首次双击会自动建两个桌面图标**：

- `AIMangaStudio`（双击 = 启动）
- `AIMangaStudio - Stop`（双击 = 关闭）

### 完整工作流（无需任何终端操作）

1. **第一次**：双击 `start.bat` → 自动建图标 → 应用启动 → 浏览器自动打开
2. **之后每天**：双击桌面 `AIMangaStudio` 图标
3. **要退出**：双击桌面 `AIMangaStudio - Stop` 图标

### 进阶子命令（如果想用终端）

| 命令                     | 行为                     |
| ---------------------- | ---------------------- |
| `start.bat`            | silent 启动（默认）          |
| `start.bat --visible`  | 同 silent，但保留窗口一会儿（调试用） |
| `start.bat --status`   | 检查端口监听状态               |
| `start.bat --stop`     | 停服                     |
| `start.bat --shortcut` | 强制重建桌面图标               |
| `start.bat --help`     | 显示所有选项                 |

### 智能端口处理

- 3001/5173 被 **node.exe** 占用（说明上次实例还在）→ 脚本**自动识别并复用**，不报错
- 被**别的程序**占用 → 询问是否清理（silent 模式直接失败让你手动处理）