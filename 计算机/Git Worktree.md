# Git Worktree 详解

## 一、什么是 Worktree

Git Worktree 允许你从同一个仓库**同时检出多个工作目录**，每个目录对应不同的分支。它们**共享同一个 `.git` 数据库**，所以提交历史、远程配置等都是同步的。

> 一个仓库，多个"窗口"，每个窗口看不同的分支。

---

## 二、解决了什么问题

平时我们一个仓库只有一个工作目录。当你在 `feature` 分支上开发，突然需要切到 `main` 修一个紧急 bug：

**没有 worktree 时，你的选择：**

1. `git stash` 暂存 → 切 `main` → 修 bug → 切回来 → `git stash pop`（麻烦且容易出错）
2. 重新 `git clone` 一份仓库（浪费磁盘和时间）

**有了 worktree：** 直接创建一个新目录检出 `main`，修完回来继续开发，互不干扰。

---

## 三、实际操作

### 3.1 查看当前 worktree

```bash
git worktree list
```

输出：

```
/home/user/my-project  abc1234 [feature]
```

### 3.2 添加新的 worktree

```bash
git worktree add ../my-project-main main
```

在 `../my-project-main` 创建新目录，检出 `main` 分支。文件系统变成：

```
home/user/
├── my-project/           ← 原目录，feature 分支
│   ├── .git/             ← Git 仓库数据（文件夹）
│   ├── src/
│   └── ...
└── my-project-main/      ← 新 worktree，main 分支
    ├── .git              ← 注意：这是一个文件！指向原仓库
    ├── src/
    └── ...
```

再看列表：

```
/home/user/my-project       abc1234 [feature]
/home/user/my-project-main  def5678 [main]
```

### 3.3 在新 worktree 里工作

```bash
cd ../my-project-main
vim src/bug.js
git add .
git commit -m "fix: 紧急修复 bug"
git push
```

修完回到原目录，代码一点没动：

```bash
cd ../my-project
# 还在 feature 分支
```

### 3.4 删除 worktree

```bash
git worktree remove ../my-project-main
```

或者手动删了目录后执行：

```bash
git worktree prune
```

### 3.5 创建新分支的 worktree

```bash
git worktree add ../my-project-experiment -b experiment
```

`-b experiment` 基于当前 HEAD 创建新分支 `experiment` 并检出。

---

## 四、重要规则

1. **同一个分支不能被两个 worktree 同时检出**
2. **所有 worktree 共享仓库数据**：在任何一个 worktree 里 fetch、commit，其他 worktree 都能看到（git log 同步，但工作区文件不会自动变）
3. **新 worktree 的 `.git` 是一个文件**（不是目录），内容是指向主仓库 `.git` 目录的路径

---

## 五、使用场景

| 场景          | 说明                               |
| ----------- | -------------------------------- |
| 紧急修 bug     | 不用 stash，直接开个 worktree 切到 main 修 |
| 对比两个分支      | 两个目录并排打开，方便对比                    |
| 长时间任务       | 一个目录在跑测试，另一个继续开发                 |
| Code Review | 检出同事的分支看代码，不影响自己的工作              |

---

## 六、常用命令速查

```bash
git worktree add <路径> <分支>       # 添加 worktree
git worktree add <路径> -b <新分支>  # 创建新分支并添加 worktree
git worktree list                    # 列出所有 worktree
git worktree remove <路径>           # 移除 worktree
git worktree prune                   # 清理失效的 worktree 记录
```

---

## 总结

**Worktree = 一个仓库开多个工作目录，各自独立工作，互不打扰。** 比 stash 和重新 clone 都优雅。