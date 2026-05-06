# TeamMember 数据恢复 - 快速执行指南

## 文档概述

本指南将帮助您快速执行 TeamMember 数据恢复操作，解决由于同步导致的 `team_members` 表被删除重建的问题。

---

## 问题简述

**现象**: 同步用户数据时，`team_members` 表被物理删除并重新创建，导致：
- 原有的 `teamMember._id` (tmbId) 全部丢失
- 12个关联表的外键引用失效
- 用户无法访问历史数据（聊天、应用、知识库等）

**根本原因**: 同步代码使用了 `deleteMany()` 而非软删除

**恢复策略**: 通过 `chatLogs.userId -> chatLogs.chatId -> chats.tmbId` 找回旧的 tmbId，删除错误的新记录，使用旧 _id 重新创建

---

## 文件清单

| 文件名 | 用途 | 是否必须执行 |
|--------|------|------------|
| `teammember-recovery-plan.md` | 详细的恢复方案文档 | 必读 |
| `teammember-recovery-script.js` | 数据恢复脚本 | 是 |
| `teammember-validation-script.js` | 数据验证脚本 | 是（恢复后） |
| `teammember-rollback-script.js` | 回滚脚本（出错时使用） | 备用 |
| `README-恢复指南.md` | 本文件 | 必读 |

---

## 快速执行步骤

### 准备阶段（5分钟）

#### 1. 获取必要信息

您需要准备以下信息：

```bash
# MongoDB 连接信息
MongoDB连接字符串: mongodb://user:pass@host:port/dbname

# 团队ID（从数据库或配置文件中获取）
团队ID (TEAM_ID): ObjectId("...")
```

#### 2. 修改脚本配置

**必须修改的3个文件**：

1. **teammember-recovery-script.js** (第20行)
   ```javascript
   const TEAM_ID = ObjectId("您的teamId");  // ← 替换为实际值
   ```

2. **teammember-validation-script.js** (第19行)
   ```javascript
   const TEAM_ID = ObjectId("您的teamId");  // ← 替换为实际值
   ```

3. **teammember-rollback-script.js** (第18-19行)
   ```javascript
   const TEAM_ID = ObjectId("您的teamId");    // ← 替换为实际值
   const BACKUP_DATE = "20251104";             // ← 执行恢复时会自动生成
   ```

---

### 执行阶段（60-90分钟）

#### 步骤1: 连接数据库

```bash
# 连接到 MongoDB
mongosh "mongodb://your-connection-string"

# 切换到正确的数据库
use fastgpt  # 或您的数据库名
```

#### 步骤2: 加载并执行恢复脚本

```javascript
// 加载恢复脚本
load('/Users/ZhangBo/Documents/Projects/FastGPT/.claude/design/teammember-recovery-script.js')

// 执行恢复
main()
```

**脚本会自动执行以下操作**：
1. ✅ 备份所有相关表（自动生成备份日期后缀）
2. ✅ 从 chatLogs 和 chats 收集旧 tmbId 映射
3. ✅ 识别需要恢复的用户
4. ✅ 标记并删除错误的新记录
5. ✅ 使用旧 _id 重新创建 teamMember 记录
6. ✅ 更新 team_org_members 表
7. ✅ 自动验证恢复结果

**预计耗时**: 60-90分钟（取决于数据量）

#### 步骤3: 执行验证脚本

```javascript
// 加载验证脚本
load('/Users/ZhangBo/Documents/Projects/FastGPT/.claude/design/teammember-validation-script.js')

// 执行验证
main()
```

**验证内容**：
- TeamMember 表基础检查
- 外键完整性检查（12个关联表）
- 数据一致性检查
- 业务数据可访问性检查
- 孤立记录检查
- OrgMember 表特别检查

**成功标准**: 整体恢复成功率 ≥ 95%

---

### 验证阶段（10分钟）

#### 1. 检查恢复报告

恢复脚本会在最后输出详细报告，重点关注：

```
整体恢复成功率: XX.XX%
```

- ✅ **≥ 99%**: 优秀，可以继续
- ⚠️ **95-99%**: 良好，检查未恢复的记录
- ❌ **< 95%**: 需要排查问题或回滚

#### 2. 业务功能测试

随机选择5-10个用户，测试以下功能：
- [ ] 能否查看历史聊天记录
- [ ] 能否访问自己创建的应用
- [ ] 能否访问自己的知识库
- [ ] 组织权限是否正常

#### 3. 记录备份信息

**重要**：记录备份日期，以便将来回滚或清理

```
备份日期: 20251104  # 示例，实际以脚本输出为准
备份表命名格式: {表名}_backup_20251104
```

---

## 异常处理

### 场景1: 恢复成功率 < 95%

**处理步骤**：

1. 查看验证报告，找出哪些表有问题
2. 执行以下命令查看详细错误：

```javascript
// 检查某个表的无效记录
const validTmbIds = db.team_members.distinct('_id', {
  teamId: TEAM_ID,
  syncStatus: { $ne: -1 }
});

db.chats.find({
  teamId: TEAM_ID,
  tmbId: { $nin: validTmbIds }
}).limit(10).toArray();
```

3. 考虑执行回滚，然后排查问题

### 场景2: 执行过程中断

**处理步骤**：

1. 首先检查备份是否已创建：

```javascript
load('/Users/ZhangBo/Documents/Projects/FastGPT/.claude/design/teammember-rollback-script.js')
checkBackups()  // 检查备份状态
```

2. 如果备份已创建，执行回滚：

```javascript
// 修改脚本中的 USER_CONFIRMED = true
quickRollback()  // 快速回滚
```

3. 排查中断原因后重新执行恢复脚本

### 场景3: 用户反馈数据异常

**处理步骤**：

1. 验证具体用户的数据：

```javascript
const userId = ObjectId("用户的userId");
const tmb = db.team_members.findOne({ userId: userId });

print(`用户 tmbId: ${tmb._id}`);
print(`聊天数量: ${db.chats.countDocuments({ userId: userId, tmbId: tmb._id })}`);
print(`应用数量: ${db.apps.countDocuments({ userId: userId, tmbId: tmb._id })}`);
```

2. 如果是个别用户问题，可以手动修复
3. 如果是普遍问题，考虑回滚

---

## 回滚操作

### 何时需要回滚？

- ✅ 恢复成功率 < 90%
- ✅ 出现大量用户投诉
- ✅ 发现严重的数据不一致
- ✅ 业务功能无法正常使用

### 如何回滚？

#### 方法1: 使用回滚脚本（推荐）

```javascript
// 1. 加载回滚脚本
load('/Users/ZhangBo/Documents/Projects/FastGPT/.claude/design/teammember-rollback-script.js')

// 2. 检查备份（安全，只读）
checkBackups()

// 3. 修改脚本中的配置
// - TEAM_ID: 您的团队ID
// - BACKUP_DATE: 备份日期（从恢复脚本输出中获取）
// - USER_CONFIRMED: 改为 true

// 4. 执行回滚
main()  // 完整回滚（含快照）
// 或
quickRollback()  // 快速回滚（不含快照）
```

#### 方法2: 手动回滚（简单直接）

```javascript
const BACKUP_DATE = "20251104";  // 替换为实际备份日期

// 对每个表执行回滚
function rollbackTable(tableName) {
  const backupName = `${tableName}_backup_${BACKUP_DATE}`;

  // 1. 删除当前数据
  db[tableName].deleteMany({ teamId: TEAM_ID });

  // 2. 从备份恢复
  db[backupName].find({ teamId: TEAM_ID }).forEach(doc => {
    db[tableName].insertOne(doc);
  });

  print(`${tableName} 回滚完成`);
}

// 执行回滚
['team_members', 'team_org_members', 'chats', 'apps', 'datasets'].forEach(rollbackTable);
```

---

## 后续维护

### 短期（1-7天）

- [ ] 每天检查用户反馈
- [ ] 监控系统日志，关注与 tmbId 相关的错误
- [ ] 保留备份表，不要删除

### 中期（1-2周）

- [ ] 确认业务功能稳定
- [ ] 随机抽查用户数据完整性
- [ ] 准备删除备份表

### 长期（修复根本问题）

#### 1. 修复同步代码

**问题代码位置**: `packages/service/support/user/team/controller.ts`

**错误写法**:
```typescript
// ❌ 使用物理删除
const invalidateMembersResult = await MongoTeamMember.deleteMany({
  syncStatus: 2,
  teamId: defaultTeamId
});
```

**正确写法**:
```typescript
// ✓ 使用软删除
const invalidateMembersResult = await MongoTeamMember.updateMany(
  {
    syncStatus: 2,
    teamId: defaultTeamId
  },
  {
    $set: {
      syncStatus: -1,  // 标记为无效
      updateTime: new Date()
    }
  }
);
```

#### 2. 添加数据一致性检查

创建定时任务，每天检查数据一致性：

```javascript
// 检查脚本（可以加入 cron 任务）
function checkDataIntegrity() {
  const validTmbIds = db.team_members.distinct('_id', {
    teamId: TEAM_ID,
    syncStatus: { $ne: -1 }
  });

  const tables = ['chats', 'apps', 'datasets', 'team_org_members'];

  tables.forEach(table => {
    const invalid = db[table].countDocuments({
      teamId: TEAM_ID,
      tmbId: { $nin: validTmbIds }
    });

    if (invalid > 0) {
      // 发送告警
      print(`警告: ${table} 表有 ${invalid} 条无效 tmbId 引用`);
    }
  });
}

// 每天运行
checkDataIntegrity();
```

#### 3. 优化同步流程

建议采用三阶段同步：
1. **标记阶段**: 将待同步记录标记为 `syncStatus = 2`
2. **处理阶段**: 更新或创建记录
3. **清理阶段**: 将未处理的记录标记为 `syncStatus = -1`（而非删除）

---

## 常见问题 FAQ

### Q1: 恢复过程需要停机吗？

**A**: 不需要。但建议在业务低峰期执行，恢复过程中：
- 用户可以正常使用系统
- 可能有短暂的性能下降
- 建议提前通知用户

### Q2: 恢复失败可以重新执行吗？

**A**: 可以。流程如下：
1. 先执行回滚，恢复到备份状态
2. 排查失败原因
3. 修复问题后重新执行恢复脚本

### Q3: 为什么不直接更新所有关联表的 tmbId？

**A**: 因为关联表（chats, apps等）已经包含正确的旧 tmbId，我们的策略是：
- 恢复 teamMember 表使用旧 _id
- 这样就不需要更新其他11个表，减少操作风险

### Q4: 备份会占用多少空间？

**A**: 备份大小约等于当前数据大小，建议预留至少2倍的存储空间。

### Q5: 多久后可以删除备份？

**A**: 建议：
- 最少保留7天
- 确认业务稳定后再删除
- 删除前再次验证数据完整性

删除备份的命令：
```javascript
const BACKUP_DATE = "20251104";
['team_members', 'team_org_members', 'chats', 'apps', 'datasets'].forEach(table => {
  db[`${table}_backup_${BACKUP_DATE}`].drop();
});
```

### Q6: 如果某个用户的数据仍然有问题怎么办？

**A**: 可以针对单个用户手动修复：

```javascript
// 1. 找到用户的正确 tmbId
const userId = ObjectId("用户的userId");
const correctTmbId = db.chats.findOne({ userId: userId })?.tmbId;

// 2. 创建或更新 teamMember
db.team_members.updateOne(
  { userId: userId },
  { $set: { _id: correctTmbId, /* 其他字段 */ } },
  { upsert: true }
);

// 3. 更新 orgMember
db.team_org_members.updateMany(
  { userId: userId },
  { $set: { tmbId: correctTmbId } }
);
```

---

## 技术支持

### 执行前

- [ ] 仔细阅读 `teammember-recovery-plan.md`
- [ ] 确认已修改所有配置项
- [ ] 确保有足够的磁盘空间
- [ ] 选择业务低峰期执行

### 执行中

- [ ] 观察脚本输出，记录异常信息
- [ ] 不要中断脚本执行
- [ ] 准备好回滚命令

### 执行后

- [ ] 查看验证报告
- [ ] 测试业务功能
- [ ] 保存备份信息
- [ ] 监控用户反馈

---

## 联系方式

**执行负责人**: ___________
**执行时间**: ___________
**备份日期**: ___________
**验证人**: ___________

---

**文档版本**: v1.0
**最后更新**: 2025-11-04
**适用场景**: TeamMember 表被删除重建导致的数据关联问题
