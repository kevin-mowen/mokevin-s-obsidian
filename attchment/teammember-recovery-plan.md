# TeamMember 数据恢复详细方案

## 文档信息
- **创建时间**: 2025-11-04
- **问题严重级别**: 高危
- **预计执行时间**: 60-90分钟
- **数据规模**: 中等（1-10万条聊天记录）

---

## 一、问题分析

### 1.1 问题根源

在用户同步过程中，`team_members` 表的数据被**物理删除**并重新创建，导致：
- 原有的 `teamMember._id` 全部丢失
- 所有依赖 `tmbId` 字段的12个表的外键关联失效
- 用户无法访问历史数据（聊天、应用、知识库等）

**问题代码位置**:
`packages/service/support/user/team/teamMemberSchema.ts` 的同步逻辑使用了 `deleteMany()` 而非软删除。

### 1.2 影响范围

#### 直接受影响的表（12个）：
1. **chats** - 聊天会话表（包含旧 tmbId）
2. **chat_items** - 聊天消息表
3. **apps** - 应用表（包含旧 tmbId）
4. **datasets** - 知识库表（包含旧 tmbId）
5. **dataset_collections** - 知识库集合表
6. **team_org_members** - 组织成员表（需要重点更新）
7. **team_group_members** - 成员组表
8. **resource_permissions** - 资源权限表
9. **outlinks** - 外链表
10. **usages** - 使用记录表
11. **eval** - 评估表
12. **sharechatitems** - 分享聊天表

#### 间接受影响：
- **app_chat_logs** - 通过 userId 间接关联

### 1.3 数据关联关系

```
旧 teamMember (已删除)
    ├── _id (旧tmbId) ← 保存在 chats、apps、datasets 等表中
    ├── userId → 可以在新 teamMember 表中找到
    └── teamId → 同上

新 teamMember (错误创建)
    ├── _id (新tmbId) ← 与旧tmbId不同，导致关联失效
    ├── userId → 相同
    └── teamId → 相同

恢复策略：
    userId → 找到新 teamMember._id
    userId → 从 chats/apps 等表找到旧 tmbId
    删除新 teamMember
    用旧 _id 重新创建 teamMember
```

---

## 二、恢复策略

### 2.1 核心原则

**混合恢复策略**：
- ✅ **有旧数据的用户**：恢复旧 tmbId（删除新记录，用旧 _id 重建）
- ✅ **纯新用户**：保留新 tmbId（无需处理）
- ✅ **错误记录**：标记为 `syncStatus = -1`（无效状态）

### 2.2 识别标准

**有旧数据的用户** = 满足以下任一条件：
1. `chats` 表中存在该用户的 tmbId（且与当前新 tmbId 不同）
2. `apps` 表中存在该用户的 tmbId（且与当前新 tmbId 不同）
3. `datasets` 表中存在该用户的 tmbId（且与当前新 tmbId 不同）

### 2.3 恢复优先级

| 优先级 | 表名 | 原因 | 处理方式 |
|--------|------|------|----------|
| P0 | team_members | 核心表 | 重建旧记录 |
| P0 | team_org_members | 组织关系 | 更新 tmbId |
| P1 | chats | 已包含旧 tmbId | 无需更新 |
| P1 | apps | 已包含旧 tmbId | 无需更新 |
| P1 | datasets | 已包含旧 tmbId | 无需更新 |
| P2 | 其他关联表 | 通过关联更新 | 按需更新 |

---

## 三、执行步骤

### 阶段一：准备与备份（5-10分钟）

#### 3.1 连接数据库
```bash
mongosh "mongodb://your-connection-string"
use fastgpt  # 或您的数据库名
```

#### 3.2 数据备份
```javascript
// 设置备份日期
const backupDate = new Date().toISOString().split('T')[0].replace(/-/g, '');

// 备份核心表
const tablesToBackup = [
  'team_members',
  'team_org_members',
  'chats',
  'chat_items',
  'apps',
  'datasets',
  'dataset_collections',
  'outlinks',
  'usages',
  'eval',
  'sharechatitems',
  'resource_permissions',
  'team_group_members'
];

tablesToBackup.forEach(table => {
  const backupName = `${table}_backup_${backupDate}`;
  print(`正在备份 ${table} -> ${backupName}...`);
  db.getCollection(table).aggregate([{ $out: backupName }]);
  print(`✓ ${table} 备份完成`);
});

print(`\n所有表备份完成！备份后缀: _backup_${backupDate}`);
```

#### 3.3 预检查
```javascript
// 获取团队ID（需要替换为实际值）
const TEAM_ID = ObjectId("6557217d3a3d1d384e32300b"); // ← 必须填写

// 统计当前状态
print("\n=== 当前数据状态 ===");
print(`团队成员总数: ${db.team_members.countDocuments({ teamId: TEAM_ID })}`);
print(`聊天会话总数: ${db.chats.countDocuments({ teamId: TEAM_ID })}`);
print(`应用总数: ${db.apps.countDocuments({ teamId: TEAM_ID })}`);
print(`知识库总数: ${db.datasets.countDocuments({ teamId: TEAM_ID })}`);
```

---

### 阶段二：收集旧 tmbId 映射（10-15分钟）

#### 3.4 从关联表提取旧 tmbId
```javascript
print("\n=== 收集旧 tmbId 映射 ===");

// 数据结构：{ userId: { oldTmbId: ObjectId, sources: ['chats', 'apps'], teamId: ObjectId } }
const userOldTmbMap = {};

// 3.4.1 从 chats 表收集
print("\n1. 从 chats 表收集旧 tmbId...");
db.chats.aggregate([
  { $match: { teamId: TEAM_ID, tmbId: { $exists: true } } },
  { $group: { _id: "$userId", tmbId: { $first: "$tmbId" }, teamId: { $first: "$teamId" } } }
]).forEach(item => {
  if (item._id && item.tmbId) {
    const userIdStr = item._id.toString();
    if (!userOldTmbMap[userIdStr]) {
      userOldTmbMap[userIdStr] = {
        userId: item._id,
        oldTmbId: item.tmbId,
        teamId: item.teamId,
        sources: ['chats']
      };
    } else if (!userOldTmbMap[userIdStr].sources.includes('chats')) {
      userOldTmbMap[userIdStr].sources.push('chats');
    }
  }
});
print(`  ✓ 从 chats 表找到 ${Object.keys(userOldTmbMap).length} 个用户`);

// 3.4.2 从 apps 表收集
print("\n2. 从 apps 表收集旧 tmbId...");
db.apps.aggregate([
  { $match: { teamId: TEAM_ID, tmbId: { $exists: true } } },
  { $group: { _id: "$userId", tmbId: { $first: "$tmbId" }, teamId: { $first: "$teamId" } } }
]).forEach(item => {
  if (item._id && item.tmbId) {
    const userIdStr = item._id.toString();
    if (!userOldTmbMap[userIdStr]) {
      userOldTmbMap[userIdStr] = {
        userId: item._id,
        oldTmbId: item.tmbId,
        teamId: item.teamId,
        sources: ['apps']
      };
    } else {
      if (!userOldTmbMap[userIdStr].sources.includes('apps')) {
        userOldTmbMap[userIdStr].sources.push('apps');
      }
      // 验证 tmbId 一致性
      if (userOldTmbMap[userIdStr].oldTmbId.toString() !== item.tmbId.toString()) {
        print(`  ⚠️  警告: userId ${userIdStr} 在不同表中的 tmbId 不一致！`);
      }
    }
  }
});
print(`  ✓ 总共找到 ${Object.keys(userOldTmbMap).length} 个有旧数据的用户`);

// 3.4.3 从 datasets 表补充
print("\n3. 从 datasets 表补充旧 tmbId...");
db.datasets.aggregate([
  { $match: { teamId: TEAM_ID, tmbId: { $exists: true } } },
  { $group: { _id: "$userId", tmbId: { $first: "$tmbId" }, teamId: { $first: "$teamId" } } }
]).forEach(item => {
  if (item._id && item.tmbId) {
    const userIdStr = item._id.toString();
    if (!userOldTmbMap[userIdStr]) {
      userOldTmbMap[userIdStr] = {
        userId: item._id,
        oldTmbId: item.tmbId,
        teamId: item.teamId,
        sources: ['datasets']
      };
    } else if (!userOldTmbMap[userIdStr].sources.includes('datasets')) {
      userOldTmbMap[userIdStr].sources.push('datasets');
    }
  }
});
print(`  ✓ 最终找到 ${Object.keys(userOldTmbMap).length} 个需要恢复的用户`);

// 3.4.4 输出统计信息
print("\n=== 旧 tmbId 收集统计 ===");
const sourcesCount = {};
Object.values(userOldTmbMap).forEach(item => {
  item.sources.forEach(source => {
    sourcesCount[source] = (sourcesCount[source] || 0) + 1;
  });
});
print(`数据来源分布:`);
Object.entries(sourcesCount).forEach(([source, count]) => {
  print(`  - ${source}: ${count} 个用户`);
});
```

#### 3.5 识别需要处理的用户
```javascript
print("\n=== 识别需要处理的用户 ===");

// 数据结构：{ userId: { oldTmbId: ObjectId, newTmbId: ObjectId, needRecover: boolean } }
const recoveryPlan = {};

// 3.5.1 遍历所有当前的 teamMember
db.team_members.find({ teamId: TEAM_ID }).forEach(currentTmb => {
  const userIdStr = currentTmb.userId.toString();

  // 检查是否有旧数据
  if (userOldTmbMap[userIdStr]) {
    const oldTmbId = userOldTmbMap[userIdStr].oldTmbId;
    const newTmbId = currentTmb._id;

    // 判断是否需要恢复（旧ID != 新ID）
    const needRecover = oldTmbId.toString() !== newTmbId.toString();

    recoveryPlan[userIdStr] = {
      userId: currentTmb.userId,
      teamId: currentTmb.teamId,
      oldTmbId: oldTmbId,
      newTmbId: newTmbId,
      needRecover: needRecover,
      currentRecord: currentTmb,
      sources: userOldTmbMap[userIdStr].sources
    };
  } else {
    // 纯新用户，无需处理
    recoveryPlan[userIdStr] = {
      userId: currentTmb.userId,
      teamId: currentTmb.teamId,
      newTmbId: currentTmb._id,
      needRecover: false,
      isPureNew: true
    };
  }
});

// 3.5.2 统计
const needRecoverCount = Object.values(recoveryPlan).filter(p => p.needRecover).length;
const pureNewCount = Object.values(recoveryPlan).filter(p => p.isPureNew).length;

print(`\n需要恢复的用户: ${needRecoverCount}`);
print(`纯新用户（无需处理）: ${pureNewCount}`);
print(`总用户数: ${Object.keys(recoveryPlan).length}`);

// 3.5.3 输出需要恢复的用户列表（前10个）
if (needRecoverCount > 0) {
  print("\n需要恢复的用户示例（前10个）:");
  let count = 0;
  for (const [userIdStr, plan] of Object.entries(recoveryPlan)) {
    if (plan.needRecover && count < 10) {
      print(`  ${count + 1}. userId: ${userIdStr.substring(0, 8)}...`);
      print(`     旧tmbId: ${plan.oldTmbId.toString().substring(0, 8)}...`);
      print(`     新tmbId: ${plan.newTmbId.toString().substring(0, 8)}...`);
      print(`     数据来源: ${plan.sources.join(', ')}`);
      count++;
    }
  }
}
```

---

### 阶段三：重建 TeamMember 记录（15-20分钟）

#### 3.6 标记并删除错误的新记录
```javascript
print("\n=== 标记并删除错误的新记录 ===");

const newTmbIdsToInvalidate = [];
const newTmbIdsToDelete = [];

Object.values(recoveryPlan).forEach(plan => {
  if (plan.needRecover) {
    newTmbIdsToInvalidate.push(plan.newTmbId);
    newTmbIdsToDelete.push(plan.newTmbId);
  }
});

print(`即将处理 ${newTmbIdsToInvalidate.length} 条记录`);

// 3.6.1 第一步：标记为无效状态（软删除）
print("\n1. 标记为 syncStatus = -1...");
const markResult = db.team_members.updateMany(
  { _id: { $in: newTmbIdsToInvalidate } },
  {
    $set: {
      syncStatus: -1,
      updateTime: new Date(),
      invalidatedAt: new Date(),
      invalidateReason: 'TeamMember重建恢复：此记录为错误创建，已被旧记录替换'
    }
  }
);
print(`  ✓ 标记了 ${markResult.modifiedCount} 条记录为无效`);

// 3.6.2 第二步：物理删除（为了给旧_id腾出空间）
print("\n2. 物理删除错误记录...");
const deleteResult = db.team_members.deleteMany(
  { _id: { $in: newTmbIdsToDelete } }
);
print(`  ✓ 删除了 ${deleteResult.deletedCount} 条记录`);
```

#### 3.7 用旧 _id 重新创建 TeamMember 记录
```javascript
print("\n=== 用旧 _id 重新创建 TeamMember 记录 ===");

const recordsToInsert = [];

Object.values(recoveryPlan).forEach(plan => {
  if (plan.needRecover) {
    // 使用原记录的数据，但替换 _id
    const oldRecord = plan.currentRecord;
    const newRecord = {
      _id: plan.oldTmbId,  // ← 关键：使用旧的 _id
      teamId: oldRecord.teamId,
      userId: oldRecord.userId,
      name: oldRecord.name,
      role: oldRecord.role,
      status: oldRecord.status,
      defaultTeam: oldRecord.defaultTeam,
      createTime: oldRecord.createTime,
      updateTime: new Date(),
      syncStatus: oldRecord.syncStatus === 2 ? 1 : oldRecord.syncStatus,  // 将同步中状态改为已同步
      // 保留其他所有字段
      ...Object.fromEntries(
        Object.entries(oldRecord).filter(([key]) =>
          !['_id', 'teamId', 'userId', 'updateTime', 'syncStatus'].includes(key)
        )
      )
    };
    recordsToInsert.push(newRecord);
  }
});

print(`准备插入 ${recordsToInsert.length} 条记录...`);

// 分批插入（避免超时）
const BATCH_SIZE = 1000;
let inserted = 0;

for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
  const batch = recordsToInsert.slice(i, i + BATCH_SIZE);
  try {
    const insertResult = db.team_members.insertMany(batch, { ordered: false });
    inserted += Object.keys(insertResult.insertedIds).length;
    print(`  批次 ${Math.floor(i / BATCH_SIZE) + 1}: 插入 ${Object.keys(insertResult.insertedIds).length} 条`);
  } catch (error) {
    // 处理可能的重复键错误
    print(`  ⚠️  批次 ${Math.floor(i / BATCH_SIZE) + 1} 部分失败: ${error.message}`);
    // 继续处理剩余批次
  }
}

print(`\n✓ 总共成功插入 ${inserted} 条记录`);
```

---

### 阶段四：更新关联表（20-30分钟）

#### 3.8 更新 team_org_members 表
```javascript
print("\n=== 更新 team_org_members 表 ===");

// 3.8.1 构建 新tmbId -> 旧tmbId 的映射
const newToOldTmbMap = {};
Object.values(recoveryPlan).forEach(plan => {
  if (plan.needRecover) {
    newToOldTmbMap[plan.newTmbId.toString()] = plan.oldTmbId;
  }
});

// 3.8.2 查找并更新 org_members
print("\n查找需要更新的 org_members 记录...");
const orgMemberBulkOps = [];

db.team_org_members.find({ teamId: TEAM_ID }).forEach(orgMember => {
  const currentTmbIdStr = orgMember.tmbId.toString();

  // 检查当前 tmbId 是否是错误的新ID
  if (newToOldTmbMap[currentTmbIdStr]) {
    const correctTmbId = newToOldTmbMap[currentTmbIdStr];
    orgMemberBulkOps.push({
      updateOne: {
        filter: { _id: orgMember._id },
        update: {
          $set: {
            tmbId: correctTmbId,
            updateTime: new Date()
          }
        }
      }
    });
  }
});

print(`找到 ${orgMemberBulkOps.length} 条需要更新的记录`);

// 3.8.3 批量更新
if (orgMemberBulkOps.length > 0) {
  const orgUpdateResult = db.team_org_members.bulkWrite(orgMemberBulkOps, { ordered: false });
  print(`✓ 成功更新 ${orgUpdateResult.modifiedCount} 条 org_members 记录`);
} else {
  print("无需更新 org_members 表");
}
```

#### 3.9 验证其他关联表（可选）
```javascript
print("\n=== 验证其他关联表 ===");

const validTmbIds = db.team_members.distinct('_id', { teamId: TEAM_ID });

const tablesToCheck = [
  'chats',
  'chat_items',
  'apps',
  'datasets',
  'dataset_collections',
  'outlinks',
  'usages',
  'eval',
  'sharechatitems',
  'resource_permissions',
  'team_group_members'
];

print("\n检查各表的 tmbId 有效性:");
tablesToCheck.forEach(tableName => {
  const total = db.getCollection(tableName).countDocuments({ teamId: TEAM_ID });
  const invalid = db.getCollection(tableName).countDocuments({
    teamId: TEAM_ID,
    tmbId: { $exists: true, $nin: validTmbIds }
  });
  const valid = total - invalid;
  const rate = total > 0 ? ((valid / total) * 100).toFixed(2) : '100.00';

  const status = invalid === 0 ? '✓' : '⚠️';
  print(`  ${status} ${tableName.padEnd(25)}: 总计 ${String(total).padStart(6)}, 有效 ${String(valid).padStart(6)}, 无效 ${String(invalid).padStart(6)}, 有效率 ${rate}%`);
});
```

---

### 阶段五：数据验证（5-10分钟）

#### 3.10 最终验证
```javascript
print("\n\n");
print("=".repeat(60));
print("           数据恢复最终验证报告");
print("=".repeat(60));

// 3.10.1 TeamMember 表验证
print("\n【1】TeamMember 表状态:");
const totalTmb = db.team_members.countDocuments({ teamId: TEAM_ID });
const validTmb = db.team_members.countDocuments({ teamId: TEAM_ID, syncStatus: { $ne: -1 } });
const invalidTmb = db.team_members.countDocuments({ teamId: TEAM_ID, syncStatus: -1 });
print(`  总记录数: ${totalTmb}`);
print(`  有效记录: ${validTmb}`);
print(`  无效记录: ${invalidTmb}`);
print(`  恢复的记录: ${inserted}`);

// 3.10.2 关联表验证
print("\n【2】关键关联表数据完整性:");
const chatTotal = db.chats.countDocuments({ teamId: TEAM_ID });
const chatValid = db.chats.countDocuments({
  teamId: TEAM_ID,
  tmbId: { $in: validTmbIds }
});
print(`  Chats: ${chatValid}/${chatTotal} (${((chatValid/chatTotal)*100).toFixed(2)}%)`);

const appTotal = db.apps.countDocuments({ teamId: TEAM_ID });
const appValid = db.apps.countDocuments({
  teamId: TEAM_ID,
  tmbId: { $in: validTmbIds }
});
print(`  Apps: ${appValid}/${appTotal} (${((appValid/appTotal)*100).toFixed(2)}%)`);

const dsTotal = db.datasets.countDocuments({ teamId: TEAM_ID });
const dsValid = db.datasets.countDocuments({
  teamId: TEAM_ID,
  tmbId: { $in: validTmbIds }
});
print(`  Datasets: ${dsValid}/${dsTotal} (${((dsValid/dsTotal)*100).toFixed(2)}%)`);

const orgTotal = db.team_org_members.countDocuments({ teamId: TEAM_ID });
const orgValid = db.team_org_members.countDocuments({
  teamId: TEAM_ID,
  tmbId: { $in: validTmbIds }
});
print(`  OrgMembers: ${orgValid}/${orgTotal} (${((orgValid/orgTotal)*100).toFixed(2)}%)`);

// 3.10.3 恢复成功率
const overallRate = ((chatValid + appValid + dsValid + orgValid) / (chatTotal + appTotal + dsTotal + orgTotal) * 100).toFixed(2);
print(`\n【3】整体恢复成功率: ${overallRate}%`);

// 3.10.4 备份信息
print(`\n【4】备份信息:`);
print(`  备份日期: ${backupDate}`);
print(`  备份表数量: ${tablesToBackup.length}`);
print(`  备份命名格式: {表名}_backup_${backupDate}`);

print("\n" + "=".repeat(60));
print("验证完成！");
print("=".repeat(60));

// 3.10.5 后续建议
print("\n【后续建议】:");
print("1. 如果验证通过，建议在业务低峰期运行几天后再删除备份表");
print("2. 监控用户反馈，确认无异常后执行以下命令删除备份:");
print("");
tablesToBackup.forEach(table => {
  print(`   db.${table}_backup_${backupDate}.drop();`);
});
print("\n3. 修复同步代码，避免再次发生类似问题");
print("4. 添加数据一致性检查定时任务");
```

---

## 四、回滚方案

### 4.1 回滚条件
如果出现以下情况，需要立即回滚：
- 恢复成功率 < 90%
- 出现大量用户投诉
- 发现数据严重不一致

### 4.2 回滚步骤
```javascript
print("\n=== 执行回滚操作 ===");

const backupDate = "20251104"; // 替换为实际备份日期

// 4.2.1 删除恢复后的数据
print("\n1. 删除恢复的数据...");
db.team_members.deleteMany({ teamId: TEAM_ID });
db.team_org_members.deleteMany({ teamId: TEAM_ID });

// 4.2.2 从备份恢复
print("\n2. 从备份恢复数据...");
tablesToBackup.forEach(table => {
  const backupName = `${table}_backup_${backupDate}`;
  print(`  恢复 ${backupName} -> ${table}...`);

  // 清空当前表
  db.getCollection(table).deleteMany({ teamId: TEAM_ID });

  // 从备份复制
  db.getCollection(backupName).find({ teamId: TEAM_ID }).forEach(doc => {
    db.getCollection(table).insertOne(doc);
  });

  print(`  ✓ ${table} 恢复完成`);
});

print("\n✓ 回滚完成！");
```

---

## 五、风险控制

### 5.1 执行前检查清单
- [ ] 已获取正确的 TEAM_ID
- [ ] 已在非业务高峰期执行
- [ ] 已通知团队成员可能的短暂影响
- [ ] 已准备好备份空间（至少2倍数据大小）
- [ ] 已测试 MongoDB 连接稳定性

### 5.2 执行中监控
- [ ] 实时查看操作日志
- [ ] 监控数据库性能指标
- [ ] 关注用户反馈渠道
- [ ] 准备好立即回滚的命令

### 5.3 执行后验证
- [ ] 检查恢复成功率 > 95%
- [ ] 随机抽查10个用户的数据
- [ ] 验证关键业务功能正常
- [ ] 保留备份至少7天

---

## 六、常见问题

### Q1: 如果某个用户在多个表中的旧 tmbId 不一致怎么办？
**A**: 脚本会输出警告信息。需要手动检查：
```javascript
// 检查不一致的情况
db.chats.distinct('tmbId', { userId: ObjectId("...") });
db.apps.distinct('tmbId', { userId: ObjectId("...") });
// 选择出现频率最高的 tmbId 作为正确值
```

### Q2: 如果执行过程中断了怎么办？
**A**: 可以从备份恢复后重新执行，或者根据日志判断中断点继续执行。

### Q3: 纯新用户会受影响吗？
**A**: 不会。脚本会自动识别并跳过纯新用户。

### Q4: 恢复后需要重启服务吗？
**A**: 不需要。MongoDB 的更改会立即生效。

### Q5: 如何验证某个具体用户的数据是否恢复？
**A**: 使用以下查询：
```javascript
const userId = ObjectId("用户ID");
const tmb = db.team_members.findOne({ userId: userId });
print(`当前 tmbId: ${tmb._id}`);

// 检查关联数据
print(`Chats: ${db.chats.countDocuments({ userId: userId, tmbId: tmb._id })}`);
print(`Apps: ${db.apps.countDocuments({ userId: userId, tmbId: tmb._id })}`);
```

---

## 七、联系信息

**执行负责人**:
**执行时间**:
**验证人**:
**备注**:

---

**文档版本**: v1.0
**最后更新**: 2025-11-04
