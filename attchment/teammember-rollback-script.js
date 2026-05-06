/**
 * TeamMember 数据回滚脚本
 *
 * 用途: 当数据恢复失败或出现严重问题时，从备份恢复数据
 * 执行环境: mongosh
 * 执行条件: 必须已经执行过恢复脚本并创建了备份
 *
 * ⚠️  警告:
 * 1. 回滚会删除当前数据并从备份恢复
 * 2. 必须确保备份表存在且数据完整
 * 3. 执行前请三思，回滚不可逆
 */

// ============================================================================
// 配置区域
// ============================================================================

const TEAM_ID = ObjectId("6557217d3a3d1d384e32300b");  // ← 必须替换为实际的 teamId
const BACKUP_DATE = "20251104";  // ← 必须替换为实际的备份日期（格式: YYYYMMDD）

// 需要回滚的表列表（必须与恢复脚本中的 TABLES_TO_BACKUP 一致）
const TABLES_TO_ROLLBACK = [
  'team_members',
  'team_org_members',
  'chats',
  'chat_items',
  'apps',
  'datasets',
  'dataset_collections',
  'app_chat_logs'
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

// ============================================================================
// 验证备份存在性
// ============================================================================

function verifyBackups() {
  printSection("验证备份存在性");

  const missingBackups = [];

  TABLES_TO_ROLLBACK.forEach(table => {
    const backupName = `${table}_backup_${BACKUP_DATE}`;
    const collections = db.getCollectionNames();

    if (!collections.includes(backupName)) {
      printError(`备份表 ${backupName} 不存在！`);
      missingBackups.push(backupName);
    } else {
      const backupCount = db.getCollection(backupName).countDocuments({ teamId: TEAM_ID });
      print(`  ✓ ${backupName}: ${backupCount} 条记录`);
    }
  });

  if (missingBackups.length > 0) {
    printError(`缺少 ${missingBackups.length} 个备份表，无法执行回滚！`);
    print("\n缺少的备份表:");
    missingBackups.forEach(name => print(`  - ${name}`));
    throw new Error("备份验证失败");
  }

  printSuccess("所有备份表验证通过");
  return true;
}

// ============================================================================
// 创建回滚前快照
// ============================================================================

function createPreRollbackSnapshot() {
  printSection("创建回滚前快照（以防需要恢复）");

  const snapshotDate = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
  const snapshotTime = new Date().toISOString().replace(/[:.]/g, '-').split('T')[1].split('-')[0];
  const snapshotSuffix = `${snapshotDate}_${snapshotTime}`;

  print(`快照后缀: snapshot_${snapshotSuffix}\n`);

  TABLES_TO_ROLLBACK.forEach((table, index) => {
    const snapshotName = `${table}_snapshot_${snapshotSuffix}`;
    print(`[${index + 1}/${TABLES_TO_ROLLBACK.length}] 创建快照: ${table} -> ${snapshotName}`);

    try {
      db.getCollection(table).aggregate([
        { $match: { teamId: TEAM_ID } },
        { $out: snapshotName }
      ]);
      printSuccess(`${table} 快照创建成功`);
    } catch (error) {
      printWarning(`${table} 快照创建失败: ${error.message}`);
    }
  });

  print(`\n如需恢复快照，使用后缀: snapshot_${snapshotSuffix}`);
  return snapshotSuffix;
}

// ============================================================================
// 执行回滚
// ============================================================================

function executeRollback() {
  printSection("执行回滚操作");

  const results = {
    deleted: {},
    restored: {},
    errors: []
  };

  TABLES_TO_ROLLBACK.forEach((table, index) => {
    print(`\n[${index + 1}/${TABLES_TO_ROLLBACK.length}] 回滚表: ${table}`);

    const backupName = `${table}_backup_${BACKUP_DATE}`;

    try {
      // 步骤1: 删除当前数据
      print(`  步骤1: 删除当前 ${table} 表的团队数据...`);
      const deleteResult = db.getCollection(table).deleteMany({ teamId: TEAM_ID });
      results.deleted[table] = deleteResult.deletedCount;
      print(`    已删除 ${deleteResult.deletedCount} 条记录`);

      // 步骤2: 从备份恢复
      print(`  步骤2: 从 ${backupName} 恢复数据...`);
      const backupDocs = db.getCollection(backupName).find({ teamId: TEAM_ID }).toArray();

      if (backupDocs.length > 0) {
        // 分批插入
        const BATCH_SIZE = 1000;
        let inserted = 0;

        for (let i = 0; i < backupDocs.length; i += BATCH_SIZE) {
          const batch = backupDocs.slice(i, i + BATCH_SIZE);
          const insertResult = db.getCollection(table).insertMany(batch, { ordered: false });
          inserted += Object.keys(insertResult.insertedIds).length;
        }

        results.restored[table] = inserted;
        printSuccess(`${table} 恢复完成: ${inserted} 条记录`);
      } else {
        results.restored[table] = 0;
        printWarning(`${backupName} 中没有团队数据`);
      }

    } catch (error) {
      printError(`${table} 回滚失败: ${error.message}`);
      results.errors.push({ table, error: error.message });
    }
  });

  return results;
}

// ============================================================================
// 验证回滚结果
// ============================================================================

function verifyRollback() {
  printSection("验证回滚结果");

  const verificationResults = {};

  TABLES_TO_ROLLBACK.forEach(table => {
    const backupName = `${table}_backup_${BACKUP_DATE}`;

    const currentCount = db.getCollection(table).countDocuments({ teamId: TEAM_ID });
    const backupCount = db.getCollection(backupName).countDocuments({ teamId: TEAM_ID });

    verificationResults[table] = {
      current: currentCount,
      backup: backupCount,
      match: currentCount === backupCount
    };

    const status = currentCount === backupCount ? '✓' : '⚠️';
    print(`${status} ${table.padEnd(25)}: 当前 ${String(currentCount).padStart(6)} | 备份 ${String(backupCount).padStart(6)} | ${currentCount === backupCount ? '匹配' : '不匹配'}`);
  });

  const allMatch = Object.values(verificationResults).every(r => r.match);

  if (allMatch) {
    printSuccess("\n所有表都已成功回滚到备份状态！");
  } else {
    printWarning("\n部分表的数据量与备份不匹配，请检查");
  }

  return verificationResults;
}

// ============================================================================
// 主函数
// ============================================================================

function main() {
  const startTime = new Date();

  printHeader("TeamMember 数据回滚脚本");
  print(`执行时间: ${startTime.toISOString()}`);
  print(`团队ID: ${TEAM_ID}`);
  print(`备份日期: ${BACKUP_DATE}\n`);

  // 最后确认
  printWarning("⚠️⚠️⚠️  重要警告  ⚠️⚠️⚠️");
  print("\n此操作将:");
  print("  1. 删除当前所有表的团队数据");
  print("  2. 从备份恢复数据");
  print("  3. 丢失恢复脚本执行后的所有更改");
  print("\n请确认您真的要执行回滚操作！");
  print("\n如果确认，请在下方输入 'YES' (大写) 并回车继续...");
  print("否则请关闭终端取消操作。\n");

  // 注意: mongosh 不支持交互式输入，所以需要用户修改脚本来确认
  const USER_CONFIRMED = false;  // ← 用户需要将此改为 true 才能执行

  if (!USER_CONFIRMED) {
    printError("未确认执行，回滚已取消");
    print("\n如需执行回滚，请:");
    print("  1. 将脚本中的 USER_CONFIRMED 改为 true");
    print("  2. 重新加载并执行 main()");
    return;
  }

  try {
    // 步骤1: 验证备份
    verifyBackups();

    // 步骤2: 创建回滚前快照
    const snapshotSuffix = createPreRollbackSnapshot();

    // 步骤3: 执行回滚
    const rollbackResults = executeRollback();

    // 步骤4: 验证回滚
    const verificationResults = verifyRollback();

    // 生成报告
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000 / 60).toFixed(2);

    printHeader("回滚完成");

    print("\n执行摘要:");
    print(`  开始时间: ${startTime.toISOString()}`);
    print(`  结束时间: ${endTime.toISOString()}`);
    print(`  总耗时: ${duration} 分钟`);

    print("\n回滚统计:");
    TABLES_TO_ROLLBACK.forEach(table => {
      const deleted = rollbackResults.deleted[table] || 0;
      const restored = rollbackResults.restored[table] || 0;
      print(`  ${table}:`);
      print(`    删除: ${deleted} 条`);
      print(`    恢复: ${restored} 条`);
    });

    if (rollbackResults.errors.length > 0) {
      printWarning("\n回滚过程中发生的错误:");
      rollbackResults.errors.forEach(err => {
        print(`  ${err.table}: ${err.error}`);
      });
    }

    print("\n快照信息:");
    print(`  回滚前快照后缀: snapshot_${snapshotSuffix}`);
    print("  如需恢复回滚前状态，可从快照恢复");

    printSection("后续建议");
    print("  1. 验证业务功能是否正常");
    print("  2. 检查用户数据是否完整");
    print("  3. 排查恢复脚本失败的原因");
    print("  4. 修复问题后重新执行恢复脚本");

    printHeader("回滚操作完成");

  } catch (error) {
    printHeader("回滚失败");
    printError(`错误信息: ${error.message}`);
    printError(`错误堆栈: ${error.stack}`);

    printSection("紧急建议");
    print("  1. 立即停止所有数据库操作");
    print("  2. 联系数据库管理员");
    print("  3. 不要删除任何备份或快照");
    print("  4. 记录当前的错误信息");

    throw error;
  }
}

// ============================================================================
// 快速回滚函数（跳过快照）
// ============================================================================

function quickRollback() {
  printHeader("快速回滚（不创建快照）");

  printWarning("此操作不会创建回滚前快照，直接从备份恢复");

  try {
    verifyBackups();
    const rollbackResults = executeRollback();
    const verificationResults = verifyRollback();

    printSuccess("快速回滚完成");
    return { rollbackResults, verificationResults };

  } catch (error) {
    printError(`快速回滚失败: ${error.message}`);
    throw error;
  }
}

// ============================================================================
// 仅验证备份函数
// ============================================================================

function checkBackups() {
  printHeader("检查备份状态");

  try {
    verifyBackups();

    printSection("备份详细信息");

    TABLES_TO_ROLLBACK.forEach(table => {
      const backupName = `${table}_backup_${BACKUP_DATE}`;
      const backupCount = db.getCollection(backupName).countDocuments({ teamId: TEAM_ID });
      const currentCount = db.getCollection(table).countDocuments({ teamId: TEAM_ID });

      print(`\n${table}:`);
      print(`  备份表: ${backupName}`);
      print(`  备份记录数: ${backupCount}`);
      print(`  当前记录数: ${currentCount}`);
      print(`  差异: ${currentCount - backupCount} (${currentCount > backupCount ? '增加' : '减少'})`);
    });

    printSuccess("\n备份检查完成");

  } catch (error) {
    printError(`备份检查失败: ${error.message}`);
  }
}

// ============================================================================
// 执行提示
// ============================================================================

print("\n" + "=".repeat(70));
print("  TeamMember 数据回滚脚本");
print("=".repeat(70));

print("\n⚠️  警告: 回滚操作会删除当前数据并从备份恢复！");

print("\n可用的函数:");
print("  1. checkBackups()   - 检查备份状态（只读，安全）");
print("  2. main()           - 完整回滚流程（包含快照）");
print("  3. quickRollback()  - 快速回滚（不创建快照）");

print("\n执行前必须:");
print("  1. 修改脚本中的 TEAM_ID");
print("  2. 修改脚本中的 BACKUP_DATE");
print("  3. 将 USER_CONFIRMED 改为 true（仅 main() 需要）");

print("\n建议先执行: checkBackups() 检查备份是否完整\n");

// 用户需要手动调用函数来执行
// checkBackups();
// main();
