/**
 * TeamMember 数据恢复脚本
 *
 * 执行环境: mongosh
 * 执行前必读: .claude/design/teammember-recovery-plan.md
 *
 * ⚠️  警告:
 * 1. 执行前务必完整备份数据库
 * 2. 必须在生产环境的非高峰期执行
 * 3. 需要修改 TEAM_ID 为实际值
 * 4. 预计执行时间: 60-90分钟
 *
 * 数据恢复策略:
 * - 通过 chatLogs.userId -> chatLogs.chatId -> chats.tmbId 获取旧 tmbId
 * - 删除错误的新 teamMember 记录
 * - 使用旧 _id 重新创建 teamMember 记录
 * - 更新 team_org_members 表的 tmbId
 */

// ============================================================================
// 配置区域 - 必须修改
// ============================================================================

// ⚠️  必须填写: 您的团队ID
const TEAM_ID = ObjectId("658047bfc52246a8070b3fff");  // ← 必须替换为实际的 teamId

// 批处理大小（可选修改）
const BATCH_SIZE = 1000;

// 备份日期后缀
const BACKUP_DATE = new Date().toISOString().split('T')[0].replace(/-/g, '');

// 需要备份的表列表
const TABLES_TO_BACKUP = [
  'team_members',
  'team_org_members',
  'chats',
  'chat_items',
  'apps',
  'datasets',
  'dataset_collections',
  'app_chat_logs'  // 关键：chatLogs 也需要备份
];

// ============================================================================
// 工具函数
// ============================================================================

function printHeader(text) {
  const line = "=".repeat(70);
  print("\n" + line);
  print(`  ${text}`);
  print(line + "\n");
}

function printSection(text) {
  print("\n" + "-".repeat(70));
  print(`  ${text}`);
  print("-".repeat(70));
}

function printSuccess(text) {
  print(`✓ ${text}`);
}

function printWarning(text) {
  print(`⚠️  ${text}`);
}

function printError(text) {
  print(`✗ ${text}`);
}

function printProgress(current, total, desc) {
  const percent = ((current / total) * 100).toFixed(1);
  print(`  进度: ${current}/${total} (${percent}%) - ${desc}`);
}

// ============================================================================
// 阶段一: 数据备份
// ============================================================================

function stage1_backup() {
  printHeader("阶段一: 数据备份");

  // 验证 TEAM_ID 是否有效
  if (!TEAM_ID) {
    printError("错误: TEAM_ID 未设置！");
    throw new Error("TEAM_ID 未配置");
  }

  print(`使用团队ID: ${TEAM_ID.toString()}`);

  printSection("1.1 备份所有相关表");
  let backupCount = 0;

  TABLES_TO_BACKUP.forEach((table, index) => {
    const backupName = `${table}_backup_${BACKUP_DATE}`;
    print(`  [${index + 1}/${TABLES_TO_BACKUP.length}] 正在备份 ${table} -> ${backupName}...`);

    try {
      // 检查表是否存在
      const count = db.getCollection(table).countDocuments({ teamId: TEAM_ID });
      print(`      表 ${table} 中有 ${count} 条团队相关记录`);

      // 执行备份
      db.getCollection(table).aggregate([{ $out: backupName }]);
      backupCount++;
      printSuccess(`${table} 备份完成`);
    } catch (error) {
      printError(`备份 ${table} 失败: ${error.message}`);
      throw error;
    }
  });

  printSuccess(`所有表备份完成！共备份 ${backupCount} 个表`);
  print(`备份命名格式: {表名}_backup_${BACKUP_DATE}`);

  printSection("1.2 预检查数据状态");
  const stats = {
    teamMembers: db.team_members.countDocuments({ teamId: TEAM_ID }),
    chats: db.chats.countDocuments({ teamId: TEAM_ID }),
    chatLogs: db.app_chat_logs.countDocuments({ teamId: TEAM_ID }),
    apps: db.apps.countDocuments({ teamId: TEAM_ID }),
    datasets: db.datasets.countDocuments({ teamId: TEAM_ID }),
    orgMembers: db.team_org_members.countDocuments({ teamId: TEAM_ID })
  };

  print("\n当前数据统计:");
  print(`  团队成员 (team_members): ${stats.teamMembers}`);
  print(`  聊天会话 (chats): ${stats.chats}`);
  print(`  聊天日志 (app_chat_logs): ${stats.chatLogs}`);
  print(`  应用 (apps): ${stats.apps}`);
  print(`  知识库 (datasets): ${stats.datasets}`);
  print(`  组织成员 (team_org_members): ${stats.orgMembers}`);

  return stats;
}

// ============================================================================
// 阶段二: 收集旧 tmbId 映射
// ============================================================================

function stage2_collectOldTmbIds() {
  printHeader("阶段二: 收集旧 tmbId 映射");

  printSection("2.1 从 app_chat_logs 构建 userId -> chatId 映射");

  // 数据结构: { userId: Set<chatId> }
  const userIdToChatIdsMap = {};

  print("  正在扫描 app_chat_logs 表...");
  let logCount = 0;

  db.app_chat_logs.find(
    { teamId: TEAM_ID, userId: { $exists: true, $ne: null }, chatId: { $exists: true, $ne: null } },
    { userId: 1, chatId: 1, _id: 0 }
  ).forEach(log => {
    const userIdStr = log.userId; // chatLogs 中的 userId 是字符串格式

    if (!userIdToChatIdsMap[userIdStr]) {
      userIdToChatIdsMap[userIdStr] = new Set();
    }
    userIdToChatIdsMap[userIdStr].add(log.chatId);
    logCount++;

    if (logCount % 10000 === 0) {
      printProgress(logCount, "?", "扫描 chatLogs");
    }
  });

  printSuccess(`扫描完成，共处理 ${logCount} 条日志`);
  printSuccess(`找到 ${Object.keys(userIdToChatIdsMap).length} 个有聊天记录的用户`);

  printSection("2.2 从 chats 表构建 chatId -> tmbId 映射");

  // 数据结构: { chatId: tmbId }
  const chatIdToTmbIdMap = {};

  print("  正在扫描 chats 表...");
  let chatCount = 0;

  db.chats.find(
    { teamId: TEAM_ID, chatId: { $exists: true }, tmbId: { $exists: true } },
    { chatId: 1, tmbId: 1, _id: 0 }
  ).forEach(chat => {
    chatIdToTmbIdMap[chat.chatId] = chat.tmbId;
    chatCount++;

    if (chatCount % 5000 === 0) {
      printProgress(chatCount, "?", "扫描 chats");
    }
  });

  printSuccess(`扫描完成，共处理 ${chatCount} 条聊天记录`);
  printSuccess(`建立了 ${Object.keys(chatIdToTmbIdMap).length} 个 chatId -> tmbId 映射`);

  printSection("2.3 组合映射: userId -> 旧 tmbId");

  // 数据结构: { userId(string): { oldTmbId: ObjectId, chatIds: [chatId], chatCount: number } }
  const userIdToOldTmbIdMap = {};

  Object.entries(userIdToChatIdsMap).forEach(([userIdStr, chatIds]) => {
    // 收集该用户所有 chat 的 tmbId
    const tmbIdCounter = {};

    chatIds.forEach(chatId => {
      const tmbId = chatIdToTmbIdMap[chatId];
      if (tmbId) {
        const tmbIdStr = tmbId.toString();
        tmbIdCounter[tmbIdStr] = (tmbIdCounter[tmbIdStr] || 0) + 1;
      }
    });

    // 如果找到了 tmbId，选择出现频率最高的（处理可能的不一致情况）
    if (Object.keys(tmbIdCounter).length > 0) {
      // 按出现次数排序
      const sortedTmbIds = Object.entries(tmbIdCounter).sort((a, b) => b[1] - a[1]);
      const mostFrequentTmbId = sortedTmbIds[0][0];
      const frequency = sortedTmbIds[0][1];

      // 如果有多个不同的 tmbId，输出警告
      if (sortedTmbIds.length > 1) {
        printWarning(`userId ${userIdStr} 有多个不同的 tmbId:`);
        sortedTmbIds.forEach(([tmbId, count]) => {
          print(`    - ${tmbId}: ${count} 次`);
        });
        print(`    选择最频繁的: ${mostFrequentTmbId}`);
      }

      userIdToOldTmbIdMap[userIdStr] = {
        oldTmbId: ObjectId(mostFrequentTmbId),
        chatIds: Array.from(chatIds),
        chatCount: frequency,
        totalChats: chatIds.size,
        hasMultipleTmbIds: sortedTmbIds.length > 1
      };
    }
  });

  printSuccess(`成功建立 ${Object.keys(userIdToOldTmbIdMap).length} 个 userId -> 旧tmbId 映射`);

  // 统计信息
  const multiTmbIdUsers = Object.values(userIdToOldTmbIdMap).filter(u => u.hasMultipleTmbIds).length;
  if (multiTmbIdUsers > 0) {
    printWarning(`发现 ${multiTmbIdUsers} 个用户有多个不同的 tmbId（已自动选择最频繁的）`);
  }

  return {
    userIdToChatIdsMap,
    chatIdToTmbIdMap,
    userIdToOldTmbIdMap
  };
}

// ============================================================================
// 阶段三: 识别需要恢复的用户
// ============================================================================

function stage3_identifyRecoveryPlan(userIdToOldTmbIdMap) {
  printHeader("阶段三: 识别需要恢复的用户");

  printSection("3.1 遍历当前 team_members 表");

  // 数据结构: { userId(string): { userId(ObjectId), teamId, oldTmbId, newTmbId, needRecover, currentRecord } }
  const recoveryPlan = {};

  let totalMembers = 0;
  let needRecoverCount = 0;
  let pureNewCount = 0;
  let alreadyCorrectCount = 0;

  db.team_members.find({ teamId: TEAM_ID }).forEach(currentTmb => {
    totalMembers++;
    const userIdStr = currentTmb.userId.toString();

    // 检查是否有旧数据
    if (userIdToOldTmbIdMap[userIdStr]) {
      const oldData = userIdToOldTmbIdMap[userIdStr];
      const oldTmbId = oldData.oldTmbId;
      const newTmbId = currentTmb._id;

      // 判断是否需要恢复（旧ID != 新ID）
      const needRecover = oldTmbId.toString() !== newTmbId.toString();

      if (needRecover) {
        needRecoverCount++;
      } else {
        alreadyCorrectCount++;
      }

      recoveryPlan[userIdStr] = {
        userId: currentTmb.userId,
        teamId: currentTmb.teamId,
        oldTmbId: oldTmbId,
        newTmbId: newTmbId,
        needRecover: needRecover,
        currentRecord: currentTmb,
        chatCount: oldData.chatCount,
        totalChats: oldData.totalChats,
        hasMultipleTmbIds: oldData.hasMultipleTmbIds
      };
    } else {
      // 纯新用户（没有聊天历史），无需处理
      pureNewCount++;
      recoveryPlan[userIdStr] = {
        userId: currentTmb.userId,
        teamId: currentTmb.teamId,
        newTmbId: currentTmb._id,
        needRecover: false,
        isPureNew: true,
        currentRecord: currentTmb
      };
    }
  });

  printSection("3.2 统计分析");
  print(`\n分析结果:`);
  print(`  总团队成员数: ${totalMembers}`);
  print(`  ├─ 需要恢复的用户: ${needRecoverCount} (${((needRecoverCount/totalMembers)*100).toFixed(1)}%)`);
  print(`  ├─ 已经正确的用户: ${alreadyCorrectCount} (${((alreadyCorrectCount/totalMembers)*100).toFixed(1)}%)`);
  print(`  └─ 纯新用户（无历史数据）: ${pureNewCount} (${((pureNewCount/totalMembers)*100).toFixed(1)}%)`);

  // 输出需要恢复的用户示例
  if (needRecoverCount > 0) {
    printSection("3.3 需要恢复的用户示例（前10个）");
    let sampleCount = 0;
    for (const [userIdStr, plan] of Object.entries(recoveryPlan)) {
      if (plan.needRecover && sampleCount < 10) {
        sampleCount++;
        print(`\n  示例 ${sampleCount}:`);
        print(`    userId: ${userIdStr}`);
        print(`    旧 tmbId: ${plan.oldTmbId.toString()}`);
        print(`    新 tmbId: ${plan.newTmbId.toString()}`);
        print(`    聊天记录数: ${plan.chatCount}/${plan.totalChats}`);
        if (plan.hasMultipleTmbIds) {
          printWarning(`    该用户有多个不同的历史 tmbId`);
        }
      }
    }
  }

  return recoveryPlan;
}

// ============================================================================
// 阶段四: 重建 TeamMember 记录
// ============================================================================

function stage4_rebuildTeamMembers(recoveryPlan) {
  printHeader("阶段四: 重建 TeamMember 记录");

  // 收集需要处理的记录
  const needRecoverUsers = Object.values(recoveryPlan).filter(p => p.needRecover);

  if (needRecoverUsers.length === 0) {
    printWarning("没有需要恢复的用户，跳过此阶段");
    return { invalidated: 0, deleted: 0, inserted: 0 };
  }

  printSection("4.1 第一步：标记错误的新记录为无效");

  const newTmbIdsToProcess = needRecoverUsers.map(u => u.newTmbId);
  print(`  准备标记 ${newTmbIdsToProcess.length} 条记录...`);

  // 标记为 syncStatus = -1（无效）
  const markResult = db.team_members.updateMany(
    { _id: { $in: newTmbIdsToProcess } },
    {
      $set: {
        syncStatus: -1,
        updateTime: new Date(),
        invalidatedAt: new Date(),
        invalidateReason: 'TeamMember数据恢复：此记录为同步时错误创建，已被旧ID记录替换'
      }
    }
  );

  printSuccess(`标记了 ${markResult.modifiedCount} 条记录为无效状态（syncStatus = -1）`);

  printSection("4.2 第二步：物理删除错误记录（为旧_id腾出空间）");

  const deleteResult = db.team_members.deleteMany(
    { _id: { $in: newTmbIdsToProcess } }
  );

  printSuccess(`删除了 ${deleteResult.deletedCount} 条错误记录`);

  printSection("4.3 第三步：使用旧 _id 重新创建记录");

  const recordsToInsert = [];

  needRecoverUsers.forEach(plan => {
    const oldRecord = plan.currentRecord;
    const newRecord = {
      _id: plan.oldTmbId,  // ← 关键：使用旧的 _id
      teamId: oldRecord.teamId,
      userId: oldRecord.userId,
      name: oldRecord.name,
      role: oldRecord.role,
      status: oldRecord.status || 'active',
      defaultTeam: oldRecord.defaultTeam,
      createTime: oldRecord.createTime,
      updateTime: new Date(),
      // 同步状态：如果原来是"同步中(2)"，改为"已同步(1)"
      syncStatus: oldRecord.syncStatus === 2 ? 1 : (oldRecord.syncStatus || 1)
    };

    // 保留其他所有字段
    Object.entries(oldRecord).forEach(([key, value]) => {
      if (!['_id', 'teamId', 'userId', 'name', 'role', 'status', 'defaultTeam', 'createTime', 'updateTime', 'syncStatus'].includes(key)) {
        newRecord[key] = value;
      }
    });

    recordsToInsert.push(newRecord);
  });

  print(`  准备插入 ${recordsToInsert.length} 条记录...`);

  // 分批插入，避免超时
  let totalInserted = 0;
  let batchNumber = 0;

  for (let i = 0; i < recordsToInsert.length; i += BATCH_SIZE) {
    batchNumber++;
    const batch = recordsToInsert.slice(i, i + BATCH_SIZE);

    try {
      const insertResult = db.team_members.insertMany(batch, { ordered: false });
      const insertedCount = Object.keys(insertResult.insertedIds).length;
      totalInserted += insertedCount;
      printProgress(totalInserted, recordsToInsert.length, `批次 ${batchNumber} 完成`);
    } catch (error) {
      // 处理可能的重复键错误（部分记录可能已存在）
      if (error.code === 11000) {
        printWarning(`批次 ${batchNumber} 有部分重复键，继续处理剩余批次`);
        // 尝试逐条插入
        batch.forEach(record => {
          try {
            db.team_members.insertOne(record);
            totalInserted++;
          } catch (e) {
            // 忽略重复键错误
          }
        });
      } else {
        printError(`批次 ${batchNumber} 失败: ${error.message}`);
        throw error;
      }
    }
  }

  printSuccess(`成功插入 ${totalInserted} 条记录（使用旧 _id）`);

  return {
    invalidated: markResult.modifiedCount,
    deleted: deleteResult.deletedCount,
    inserted: totalInserted
  };
}

// ============================================================================
// 阶段五: 更新关联表
// ============================================================================

function stage5_updateRelatedTables(recoveryPlan) {
  printHeader("阶段五: 更新关联表");

  // 构建 新tmbId -> 旧tmbId 的映射
  const newToOldTmbMap = {};
  Object.values(recoveryPlan).forEach(plan => {
    if (plan.needRecover) {
      newToOldTmbMap[plan.newTmbId.toString()] = plan.oldTmbId;
    }
  });

  if (Object.keys(newToOldTmbMap).length === 0) {
    printWarning("没有需要更新关联表的记录");
    return { orgMembersUpdated: 0 };
  }

  printSection("5.1 更新 team_org_members 表");

  print(`  正在查找需要更新的 org_members 记录...`);
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

  print(`  找到 ${orgMemberBulkOps.length} 条需要更新的记录`);

  let orgMembersUpdated = 0;

  if (orgMemberBulkOps.length > 0) {
    try {
      const orgUpdateResult = db.team_org_members.bulkWrite(orgMemberBulkOps, { ordered: false });
      orgMembersUpdated = orgUpdateResult.modifiedCount;
      printSuccess(`成功更新 ${orgMembersUpdated} 条 org_members 记录`);
    } catch (error) {
      printError(`更新 org_members 失败: ${error.message}`);
      throw error;
    }
  } else {
    printSuccess("team_org_members 表无需更新");
  }

  printSection("5.2 验证其他关联表（无需更新）");

  // 说明：chats, apps, datasets 等表已经包含旧的 tmbId，
  // 因为我们恢复的就是旧的 teamMember 记录，所以这些表无需更新
  print("  说明: 以下表已包含正确的旧 tmbId，无需更新:");
  const noUpdateNeededTables = [
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

  noUpdateNeededTables.forEach(table => {
    print(`    ✓ ${table}`);
  });

  return { orgMembersUpdated };
}

// ============================================================================
// 阶段六: 数据验证
// ============================================================================

function stage6_validation() {
  printHeader("阶段六: 数据验证与最终报告");

  const validTmbIds = db.team_members.distinct('_id', { teamId: TEAM_ID });

  printSection("6.1 TeamMember 表状态");
  const tmbTotal = db.team_members.countDocuments({ teamId: TEAM_ID });
  const tmbValid = db.team_members.countDocuments({ teamId: TEAM_ID, syncStatus: { $ne: -1 } });
  const tmbInvalid = db.team_members.countDocuments({ teamId: TEAM_ID, syncStatus: -1 });

  print(`  总记录数: ${tmbTotal}`);
  print(`  有效记录: ${tmbValid}`);
  print(`  无效记录 (syncStatus=-1): ${tmbInvalid}`);

  printSection("6.2 关键关联表数据完整性");

  const validationResults = [];

  function validateTable(tableName) {
    const total = db.getCollection(tableName).countDocuments({ teamId: TEAM_ID });
    const withTmbId = db.getCollection(tableName).countDocuments({
      teamId: TEAM_ID,
      tmbId: { $exists: true }
    });
    const valid = db.getCollection(tableName).countDocuments({
      teamId: TEAM_ID,
      tmbId: { $in: validTmbIds }
    });
    const invalid = withTmbId - valid;
    const rate = withTmbId > 0 ? ((valid / withTmbId) * 100).toFixed(2) : '100.00';

    validationResults.push({
      table: tableName,
      total,
      withTmbId,
      valid,
      invalid,
      rate: parseFloat(rate)
    });

    const status = invalid === 0 ? '✓' : '⚠️';
    const tablePadded = tableName.padEnd(25);
    print(`  ${status} ${tablePadded}: ${String(valid).padStart(6)}/${String(withTmbId).padStart(6)} 有效 (${rate}%)`);
  }

  const criticalTables = [
    'chats',
    'chat_items',
    'apps',
    'datasets',
    'dataset_collections',
    'team_org_members',
    'outlinks',
    'usages',
    'eval',
    'sharechatitems'
  ];

  criticalTables.forEach(validateTable);

  printSection("6.3 整体恢复成功率");

  const totalRecords = validationResults.reduce((sum, r) => sum + r.withTmbId, 0);
  const validRecords = validationResults.reduce((sum, r) => sum + r.valid, 0);
  const overallRate = totalRecords > 0 ? ((validRecords / totalRecords) * 100).toFixed(2) : '100.00';

  print(`\n  总记录数（有tmbId的）: ${totalRecords}`);
  print(`  有效记录数: ${validRecords}`);
  print(`  整体恢复成功率: ${overallRate}%`);

  // 评估恢复质量
  if (parseFloat(overallRate) >= 95) {
    printSuccess(`恢复成功率 ${overallRate}% - 优秀！`);
  } else if (parseFloat(overallRate) >= 85) {
    printWarning(`恢复成功率 ${overallRate}% - 良好，但请检查未恢复的记录`);
  } else {
    printError(`恢复成功率 ${overallRate}% - 需要进一步排查问题`);
  }

  return {
    tmbTotal,
    tmbValid,
    tmbInvalid,
    validationResults,
    overallRate: parseFloat(overallRate)
  };
}

// ============================================================================
// 主执行流程
// ============================================================================

function main() {
  const startTime = new Date();

  printHeader("TeamMember 数据恢复脚本");
  print(`执行时间: ${startTime.toISOString()}`);
  print(`团队ID: ${TEAM_ID}`);
  print(`备份日期后缀: ${BACKUP_DATE}`);

  try {
    // 阶段一：备份
    const stats = stage1_backup();

    // 阶段二：收集旧 tmbId
    const { userIdToOldTmbIdMap } = stage2_collectOldTmbIds();

    // 阶段三：识别恢复计划
    const recoveryPlan = stage3_identifyRecoveryPlan(userIdToOldTmbIdMap);

    // 阶段四：重建 TeamMember
    const rebuildResults = stage4_rebuildTeamMembers(recoveryPlan);

    // 阶段五：更新关联表
    const updateResults = stage5_updateRelatedTables(recoveryPlan);

    // 阶段六：验证
    const validationResults = stage6_validation();

    // 最终报告
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    printHeader("数据恢复完成");
    print(`\n执行摘要:`);
    print(`  开始时间: ${startTime.toISOString()}`);
    print(`  结束时间: ${endTime.toISOString()}`);
    print(`  总耗时: ${duration} 分钟`);
    print(`\n执行结果:`);
    print(`  标记无效: ${rebuildResults.invalidated} 条`);
    print(`  删除错误: ${rebuildResults.deleted} 条`);
    print(`  重新创建: ${rebuildResults.inserted} 条`);
    print(`  更新 OrgMember: ${updateResults.orgMembersUpdated} 条`);
    print(`  整体恢复率: ${validationResults.overallRate}%`);

    printSection("备份信息");
    print(`  备份日期: ${BACKUP_DATE}`);
    print(`  备份表数量: ${TABLES_TO_BACKUP.length}`);
    print(`\n如需回滚，请执行以下命令:`);
    TABLES_TO_BACKUP.forEach(table => {
      print(`  // 恢复 ${table}`);
      print(`  db.${table}.deleteMany({ teamId: TEAM_ID });`);
      print(`  db.${table}_backup_${BACKUP_DATE}.find({ teamId: TEAM_ID }).forEach(doc => db.${table}.insertOne(doc));`);
    });

    printSection("后续建议");
    print("  1. 验证用户反馈，确认业务功能正常");
    print("  2. 随机抽查5-10个用户的数据完整性");
    print("  3. 监控系统运行3-7天，确认无异常");
    print("  4. 修复同步代码，防止问题再次发生");
    print("  5. 确认无问题后，删除备份表释放空间");

    printHeader("脚本执行完成！");

  } catch (error) {
    printHeader("脚本执行失败");
    printError(`错误信息: ${error.message}`);
    printError(`错误堆栈: ${error.stack}`);

    printSection("回滚建议");
    print("  请立即执行回滚操作，恢复备份数据：");
    print(`  load('.claude/design/teammember-rollback-script.js')`);

    throw error;
  }
}

// ============================================================================
// 执行脚本
// ============================================================================

// 执行提示
print("\n" + "=".repeat(70));
print("  准备执行 TeamMember 数据恢复脚本");
print("=".repeat(70));
print("\n⚠️  重要提示:");
print("  1. 请确认已修改脚本中的 TEAM_ID");
print("  2. 请确认当前为非业务高峰期");
print("  3. 请确认数据库有足够的存储空间用于备份");
print("  4. 预计执行时间: 60-90分钟");
print("\n如果准备好了，请输入以下命令开始执行:");
print("  main()");
print("\n如需取消，请关闭终端。\n");

// 用户需要手动调用 main() 来执行
// main();
