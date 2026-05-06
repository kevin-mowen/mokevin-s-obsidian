/**
 * TeamMember 数据验证脚本
 *
 * 用途: 独立验证脚本，用于恢复后的数据完整性检查
 * 执行环境: mongosh
 * 可重复执行: 是（只读操作，不修改数据）
 *
 * 使用场景:
 * 1. 恢复脚本执行后的验证
 * 2. 定期数据一致性检查
 * 3. 问题排查和诊断
 */

// ============================================================================
// 配置区域
// ============================================================================

const TEAM_ID = ObjectId("6557217d3a3d1d384e32300b");  // ← 必须替换为实际的 teamId

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

// ============================================================================
// 验证模块
// ============================================================================

/**
 * 验证1: TeamMember 表基础检查
 */
function validation1_teamMemberBasics() {
  printSection("验证1: TeamMember 表基础检查");

  const total = db.team_members.countDocuments({ teamId: TEAM_ID });
  const withSyncStatus = db.team_members.countDocuments({
    teamId: TEAM_ID,
    syncStatus: { $exists: true }
  });
  const validStatus = db.team_members.countDocuments({
    teamId: TEAM_ID,
    syncStatus: { $in: [0, 1] }
  });
  const syncingStatus = db.team_members.countDocuments({
    teamId: TEAM_ID,
    syncStatus: 2
  });
  const invalidStatus = db.team_members.countDocuments({
    teamId: TEAM_ID,
    syncStatus: -1
  });

  print(`\nTeamMember 状态统计:`);
  print(`  总记录数: ${total}`);
  print(`  有 syncStatus 字段: ${withSyncStatus}`);
  print(`  有效状态 (0,1): ${validStatus}`);
  print(`  同步中状态 (2): ${syncingStatus}`);
  print(`  无效状态 (-1): ${invalidStatus}`);

  if (syncingStatus > 0) {
    printWarning(`发现 ${syncingStatus} 条记录仍处于同步中状态，可能需要处理`);
  }

  // 检查重复的 userId
  print(`\n检查重复的 userId:`);
  const duplicateUserIds = db.team_members.aggregate([
    { $match: { teamId: TEAM_ID, syncStatus: { $ne: -1 } } },
    { $group: { _id: "$userId", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $count: "total" }
  ]).toArray();

  if (duplicateUserIds.length > 0 && duplicateUserIds[0].total > 0) {
    printError(`发现 ${duplicateUserIds[0].total} 个重复的 userId！`);
    print("\n重复的 userId 列表:");
    db.team_members.aggregate([
      { $match: { teamId: TEAM_ID, syncStatus: { $ne: -1 } } },
      { $group: { _id: "$userId", count: { $sum: 1 }, tmbIds: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 5 }
    ]).forEach(item => {
      print(`  userId: ${item._id}, 出现次数: ${item.count}`);
      print(`  tmbIds: ${item.tmbIds.map(id => id.toString()).join(', ')}`);
    });
  } else {
    printSuccess("未发现重复的 userId");
  }

  return {
    total,
    validStatus,
    syncingStatus,
    invalidStatus,
    hasDuplicates: duplicateUserIds.length > 0 && duplicateUserIds[0].total > 0
  };
}

/**
 * 验证2: 外键完整性检查
 */
function validation2_foreignKeyIntegrity() {
  printSection("验证2: 外键完整性检查");

  const validTmbIds = db.team_members.distinct('_id', {
    teamId: TEAM_ID,
    syncStatus: { $ne: -1 }
  });

  print(`\n有效的 tmbId 总数: ${validTmbIds.length}`);

  const tables = [
    { name: 'chats', field: 'tmbId' },
    { name: 'chat_items', field: 'tmbId' },
    { name: 'apps', field: 'tmbId' },
    { name: 'datasets', field: 'tmbId' },
    { name: 'dataset_collections', field: 'tmbId' },
    { name: 'team_org_members', field: 'tmbId' },
    { name: 'team_group_members', field: 'tmbId' },
    { name: 'resource_permissions', field: 'tmbId' },
    { name: 'outlinks', field: 'tmbId' },
    { name: 'usages', field: 'tmbId' },
    { name: 'eval', field: 'tmbId' },
    { name: 'sharechatitems', field: 'tmbId' }
  ];

  const results = [];

  print(`\n检查各表的 tmbId 引用完整性:\n`);

  tables.forEach(table => {
    const total = db.getCollection(table.name).countDocuments({ teamId: TEAM_ID });
    const withTmbId = db.getCollection(table.name).countDocuments({
      teamId: TEAM_ID,
      [table.field]: { $exists: true, $ne: null }
    });
    const valid = db.getCollection(table.name).countDocuments({
      teamId: TEAM_ID,
      [table.field]: { $in: validTmbIds }
    });
    const invalid = withTmbId - valid;
    const rate = withTmbId > 0 ? ((valid / withTmbId) * 100).toFixed(2) : '100.00';

    results.push({
      table: table.name,
      total,
      withTmbId,
      valid,
      invalid,
      rate: parseFloat(rate)
    });

    const status = invalid === 0 ? '✓' : '⚠️';
    const tablePadded = table.name.padEnd(25);
    const totalPadded = String(total).padStart(7);
    const withTmbIdPadded = String(withTmbId).padStart(7);
    const validPadded = String(valid).padStart(7);
    const invalidPadded = String(invalid).padStart(7);

    print(`${status} ${tablePadded} | 总:${totalPadded} | 有tmbId:${withTmbIdPadded} | 有效:${validPadded} | 无效:${invalidPadded} | ${rate}%`);

    // 如果有无效记录，显示示例
    if (invalid > 0) {
      const samples = db.getCollection(table.name).find({
        teamId: TEAM_ID,
        [table.field]: { $exists: true, $nin: validTmbIds }
      }).limit(3).toArray();

      print(`    无效记录示例:`);
      samples.forEach((doc, idx) => {
        print(`      ${idx + 1}. _id: ${doc._id}, tmbId: ${doc[table.field]}`);
      });
    }
  });

  // 计算整体成功率
  const totalRecords = results.reduce((sum, r) => sum + r.withTmbId, 0);
  const validRecords = results.reduce((sum, r) => sum + r.valid, 0);
  const overallRate = totalRecords > 0 ? ((validRecords / totalRecords) * 100).toFixed(2) : '100.00';

  print(`\n整体外键完整性: ${overallRate}%`);

  if (parseFloat(overallRate) === 100) {
    printSuccess("所有外键引用完整！");
  } else if (parseFloat(overallRate) >= 95) {
    printWarning(`外键完整性 ${overallRate}%，有少量无效引用`);
  } else {
    printError(`外键完整性 ${overallRate}%，存在较多无效引用！`);
  }

  return {
    results,
    overallRate: parseFloat(overallRate),
    totalRecords,
    validRecords
  };
}

/**
 * 验证3: 数据一致性检查（userId 和 tmbId 的关联）
 */
function validation3_dataConsistency() {
  printSection("验证3: 数据一致性检查");

  print("\n检查 chats 表的 userId 和 tmbId 一致性:");

  // 通过 app_chat_logs 获取 userId -> chatId 映射
  const chatIdToUserId = {};
  db.app_chat_logs.find(
    { teamId: TEAM_ID },
    { chatId: 1, userId: 1, _id: 0 }
  ).forEach(log => {
    if (log.userId && log.chatId) {
      chatIdToUserId[log.chatId] = log.userId;
    }
  });

  print(`  从 app_chat_logs 收集了 ${Object.keys(chatIdToUserId).length} 个 chatId -> userId 映射`);

  // 检查 chats 表的 tmbId 是否与 userId 匹配
  const userIdToTmbId = {};
  db.team_members.find(
    { teamId: TEAM_ID, syncStatus: { $ne: -1 } },
    { userId: 1, _id: 1 }
  ).forEach(tmb => {
    userIdToTmbId[tmb.userId.toString()] = tmb._id;
  });

  print(`  从 team_members 收集了 ${Object.keys(userIdToTmbId).length} 个 userId -> tmbId 映射`);

  let checkedChats = 0;
  let inconsistentChats = 0;
  const inconsistentSamples = [];

  db.chats.find({ teamId: TEAM_ID, tmbId: { $exists: true } }).forEach(chat => {
    checkedChats++;
    const userIdFromLog = chatIdToUserId[chat.chatId];

    if (userIdFromLog) {
      const expectedTmbId = userIdToTmbId[userIdFromLog];
      const actualTmbId = chat.tmbId;

      if (expectedTmbId && expectedTmbId.toString() !== actualTmbId.toString()) {
        inconsistentChats++;
        if (inconsistentSamples.length < 5) {
          inconsistentSamples.push({
            chatId: chat.chatId,
            userId: userIdFromLog,
            expectedTmbId: expectedTmbId,
            actualTmbId: actualTmbId
          });
        }
      }
    }
  });

  print(`  检查了 ${checkedChats} 条聊天记录`);
  print(`  发现 ${inconsistentChats} 条不一致的记录`);

  if (inconsistentChats > 0) {
    printWarning(`发现 userId 和 tmbId 不一致的情况`);
    print("\n不一致记录示例:");
    inconsistentSamples.forEach((sample, idx) => {
      print(`  ${idx + 1}. chatId: ${sample.chatId}`);
      print(`     userId: ${sample.userId}`);
      print(`     期望 tmbId: ${sample.expectedTmbId.toString()}`);
      print(`     实际 tmbId: ${sample.actualTmbId.toString()}`);
    });
  } else {
    printSuccess("所有 chats 记录的 userId 和 tmbId 一致");
  }

  return {
    checkedChats,
    inconsistentChats,
    consistencyRate: checkedChats > 0 ? (((checkedChats - inconsistentChats) / checkedChats) * 100).toFixed(2) : '100.00'
  };
}

/**
 * 验证4: 业务数据可访问性检查
 */
function validation4_businessDataAccessibility() {
  printSection("验证4: 业务数据可访问性检查");

  print("\n随机抽查10个用户的数据可访问性:\n");

  const samples = db.team_members.find({
    teamId: TEAM_ID,
    syncStatus: { $ne: -1 }
  }).limit(10).toArray();

  samples.forEach((tmb, idx) => {
    print(`用户 ${idx + 1}: ${tmb.name || '未命名'}`);
    print(`  userId: ${tmb.userId.toString()}`);
    print(`  tmbId: ${tmb._id.toString()}`);

    const chatsCount = db.chats.countDocuments({ teamId: TEAM_ID, tmbId: tmb._id });
    const appsCount = db.apps.countDocuments({ teamId: TEAM_ID, tmbId: tmb._id });
    const datasetsCount = db.datasets.countDocuments({ teamId: TEAM_ID, tmbId: tmb._id });

    print(`  聊天会话: ${chatsCount}`);
    print(`  应用: ${appsCount}`);
    print(`  知识库: ${datasetsCount}`);

    const hasData = chatsCount > 0 || appsCount > 0 || datasetsCount > 0;
    if (hasData) {
      printSuccess(`  数据可访问`);
    } else {
      print(`  ℹ️  无业务数据（可能是新用户）`);
    }
    print("");
  });

  return { samplesChecked: samples.length };
}

/**
 * 验证5: 孤立记录检查
 */
function validation5_orphanedRecords() {
  printSection("验证5: 孤立记录检查（无效的 tmbId 引用）");

  const validTmbIds = db.team_members.distinct('_id', {
    teamId: TEAM_ID,
    syncStatus: { $ne: -1 }
  });

  const tables = [
    'chats',
    'chat_items',
    'apps',
    'datasets',
    'dataset_collections',
    'team_org_members',
    'outlinks',
    'usages'
  ];

  print("\n查找孤立记录（tmbId 不存在于 team_members 中）:\n");

  let totalOrphaned = 0;

  tables.forEach(tableName => {
    const orphanedCount = db.getCollection(tableName).countDocuments({
      teamId: TEAM_ID,
      tmbId: { $exists: true, $nin: validTmbIds }
    });

    if (orphanedCount > 0) {
      totalOrphaned += orphanedCount;
      printWarning(`${tableName}: ${orphanedCount} 条孤立记录`);

      // 显示示例
      const sample = db.getCollection(tableName).findOne({
        teamId: TEAM_ID,
        tmbId: { $exists: true, $nin: validTmbIds }
      });

      if (sample) {
        print(`  示例 tmbId: ${sample.tmbId.toString()}`);
      }
    } else {
      printSuccess(`${tableName}: 无孤立记录`);
    }
  });

  print(`\n总孤立记录数: ${totalOrphaned}`);

  if (totalOrphaned === 0) {
    printSuccess("未发现孤立记录");
  } else {
    printWarning(`发现 ${totalOrphaned} 条孤立记录，建议进一步排查`);
  }

  return { totalOrphaned };
}

/**
 * 验证6: OrgMember 表特别检查
 */
function validation6_orgMemberCheck() {
  printSection("验证6: OrgMember 表特别检查");

  const validTmbIds = db.team_members.distinct('_id', {
    teamId: TEAM_ID,
    syncStatus: { $ne: -1 }
  });

  const orgTotal = db.team_org_members.countDocuments({ teamId: TEAM_ID });
  const orgValid = db.team_org_members.countDocuments({
    teamId: TEAM_ID,
    tmbId: { $in: validTmbIds }
  });
  const orgInvalid = orgTotal - orgValid;

  print(`\nOrgMember 表状态:`);
  print(`  总记录数: ${orgTotal}`);
  print(`  有效 tmbId: ${orgValid}`);
  print(`  无效 tmbId: ${orgInvalid}`);

  if (orgInvalid > 0) {
    printWarning(`发现 ${orgInvalid} 条 OrgMember 记录的 tmbId 无效`);

    // 检查是否有唯一索引冲突风险
    print("\n检查潜在的唯一索引冲突:");
    const duplicateCheck = db.team_org_members.aggregate([
      { $match: { teamId: TEAM_ID } },
      {
        $group: {
          _id: { teamId: "$teamId", orgId: "$orgId", tmbId: "$tmbId" },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $count: "total" }
    ]).toArray();

    if (duplicateCheck.length > 0 && duplicateCheck[0].total > 0) {
      printError(`发现 ${duplicateCheck[0].total} 组重复的 (teamId, orgId, tmbId) 组合`);
    } else {
      printSuccess("未发现重复的 (teamId, orgId, tmbId) 组合");
    }
  } else {
    printSuccess("所有 OrgMember 记录的 tmbId 有效");
  }

  return {
    orgTotal,
    orgValid,
    orgInvalid
  };
}

// ============================================================================
// 生成报告
// ============================================================================

function generateReport(results) {
  printHeader("数据验证总报告");

  print("\n【1】TeamMember 表状态");
  print(`    总记录: ${results.teamMemberBasics.total}`);
  print(`    有效: ${results.teamMemberBasics.validStatus}`);
  print(`    无效: ${results.teamMemberBasics.invalidStatus}`);
  print(`    同步中: ${results.teamMemberBasics.syncingStatus}`);
  print(`    有重复userId: ${results.teamMemberBasics.hasDuplicates ? '是 ⚠️' : '否 ✓'}`);

  print("\n【2】外键完整性");
  print(`    整体完整率: ${results.foreignKeyIntegrity.overallRate}%`);
  print(`    总记录数: ${results.foreignKeyIntegrity.totalRecords}`);
  print(`    有效记录: ${results.foreignKeyIntegrity.validRecords}`);

  print("\n【3】数据一致性");
  print(`    检查的聊天记录: ${results.dataConsistency.checkedChats}`);
  print(`    不一致记录: ${results.dataConsistency.inconsistentChats}`);
  print(`    一致性率: ${results.dataConsistency.consistencyRate}%`);

  print("\n【4】孤立记录");
  print(`    总孤立记录: ${results.orphanedRecords.totalOrphaned}`);

  print("\n【5】OrgMember 表");
  print(`    总记录: ${results.orgMemberCheck.orgTotal}`);
  print(`    有效: ${results.orgMemberCheck.orgValid}`);
  print(`    无效: ${results.orgMemberCheck.orgInvalid}`);

  // 综合评估
  printSection("综合评估");

  const issues = [];

  if (results.teamMemberBasics.hasDuplicates) {
    issues.push("TeamMember 表存在重复的 userId");
  }

  if (results.foreignKeyIntegrity.overallRate < 95) {
    issues.push(`外键完整性较低 (${results.foreignKeyIntegrity.overallRate}%)`);
  }

  if (results.dataConsistency.inconsistentChats > 0) {
    issues.push(`发现 ${results.dataConsistency.inconsistentChats} 条数据不一致`);
  }

  if (results.orphanedRecords.totalOrphaned > 0) {
    issues.push(`发现 ${results.orphanedRecords.totalOrphaned} 条孤立记录`);
  }

  if (results.orgMemberCheck.orgInvalid > 0) {
    issues.push(`OrgMember 有 ${results.orgMemberCheck.orgInvalid} 条无效记录`);
  }

  if (issues.length === 0) {
    printSuccess("所有验证通过！数据状态良好。");
  } else {
    printWarning("发现以下问题:");
    issues.forEach((issue, idx) => {
      print(`  ${idx + 1}. ${issue}`);
    });
  }

  printSection("建议");

  if (results.foreignKeyIntegrity.overallRate >= 99) {
    print("  ✓ 数据恢复成功，建议:");
    print("    1. 继续监控用户反馈");
    print("    2. 3-7天后删除备份表");
    print("    3. 修复同步代码防止问题再次发生");
  } else if (results.foreignKeyIntegrity.overallRate >= 95) {
    print("  ⚠️  数据基本恢复，但有少量问题:");
    print("    1. 检查无效记录的原因");
    print("    2. 考虑是否需要手动修复");
    print("    3. 暂不删除备份表");
  } else {
    print("  ✗ 数据恢复存在较多问题:");
    print("    1. 立即排查失败原因");
    print("    2. 考虑执行回滚操作");
    print("    3. 联系技术支持");
  }
}

// ============================================================================
// 主函数
// ============================================================================

function main() {
  const startTime = new Date();

  printHeader("TeamMember 数据验证脚本");
  print(`验证时间: ${startTime.toISOString()}`);
  print(`团队ID: ${TEAM_ID}\n`);

  try {
    // 执行所有验证
    const results = {
      teamMemberBasics: validation1_teamMemberBasics(),
      foreignKeyIntegrity: validation2_foreignKeyIntegrity(),
      dataConsistency: validation3_dataConsistency(),
      businessDataAccessibility: validation4_businessDataAccessibility(),
      orphanedRecords: validation5_orphanedRecords(),
      orgMemberCheck: validation6_orgMemberCheck()
    };

    // 生成报告
    generateReport(results);

    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    printHeader("验证完成");
    print(`总耗时: ${duration} 秒\n`);

    return results;

  } catch (error) {
    printError(`验证过程发生错误: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// 执行
// ============================================================================

print("\n" + "=".repeat(70));
print("  准备执行数据验证");
print("=".repeat(70));
print("\n请确认已修改脚本中的 TEAM_ID，然后执行:");
print("  main()\n");

// 用户需要手动调用 main() 来执行
// main();
