// ============================================================================
// 4,000ノードシード: WBS3階層×工種3種×担当10部署。決定的（mulberry32）で再現可能・UI非依存。
// 実プロジェクトに近い"疎な"グラフを生成する（既定 density≈1.15・依存と担当は工区内に集中）＝
// 「まず絞る」体験を正しく伝えるため。過密にすると絞っても混んで見え、絞り込みの価値が伝わらない。
// 性能受入テストは density:1.5 を明示指定して従来どおり検証する。
// assignee=部署名（班/セクション単位、§7.5 確定）。
// ============================================================================
import type { GraphDoc, Discipline, Status, Task } from './types';
import { emptyDoc, makeDep, makeTask, mulberry32 } from './factory';
import { collapsedForLevel } from './wbs';
import { STATUSES } from './constants';

export interface SeedOptions {
  count?: number;
  density?: number;
  seed?: number;
}

export function seedDemo(opts: SeedOptions = {}): GraphDoc {
  const target = opts.count || 4000;
  // 実プロジェクトに近い疎密度（1タスク約1.15本）。過密だと「絞っても混む」誤解を生むため抑える。
  const density = opts.density != null ? opts.density : 1.15;
  const rnd = mulberry32(opts.seed || 12345);
  // assignee = 部署名（班/セクション単位、§7.5 確定事項）。個人名ではない。
  const assignees = [
    '土木1課',
    '土木2課',
    '配管課',
    '電気計装課',
    '機械課',
    '設計1課',
    '設計2課',
    '調達課',
    '施工管理課',
    '試運転課',
  ];
  const disc3: Discipline[] = ['E', 'P', 'C'];
  const discName: Record<string, string> = { E: '設計', P: '調達', C: '施工' };
  const doc = emptyDoc('○○プラント建設（デモ4000）');
  const L1 = 6,
    L2 = 5,
    L3 = 5;
  const leaves: string[] = [];
  for (let a = 1; a <= L1; a++)
    for (let b = 1; b <= L2; b++) for (let c = 1; c <= L3; c++) leaves.push(`${a}.${b}.${c}`);
  const perLeaf = Math.ceil(target / leaves.length);
  const tasks: Task[] = [];
  for (let li = 0; li < leaves.length && tasks.length < target; li++) {
    const wbs = leaves[li];
    for (let k = 0; k < perLeaf && tasks.length < target; k++) {
      const d = disc3[k % 3];
      const isMs = k > 0 && k % 13 === 0;
      const st = STATUSES[Math.floor(rnd() * 4)] as Status;
      // 担当は「トップWBS(工区)×工種＋第2WBS」で決める＝実プロジェクトのように1部署が特定工区に
      // 集中する。全10部署を使いつつ、1部署の担当は少数の工区・工種に収束させる（過密回避）。
      // これにより「自分のタスク」で絞ると自部署の範囲だけに収まり、前後1でも数十件で扱いやすい。
      const topWbs = Number(wbs.split('.')[0]); // 1..6
      const midWbs = Number(wbs.split('.')[1] || '1'); // 1..5
      const deptIndex = (topWbs * 3 + disc3.indexOf(d) + midWbs) % assignees.length;
      tasks.push(
        makeTask(
          {
            name: `${discName[d]}-${wbs}-${k + 1}`,
            wbsCode: wbs,
            discipline: d,
            isMilestone: isMs,
            durationDays: isMs ? 0 : 1 + Math.floor(rnd() * 20),
            status: st,
            progress: st === 'DONE' ? 100 : st === 'IN_PROGRESS' ? Math.floor(rnd() * 90) : 0,
            assignee: assignees[deptIndex],
            position: { x: (li % 25) * 260 + (k % 6) * 40, y: Math.floor(li / 25) * 900 + k * 70 },
          },
          'デモ生成',
        ),
      );
    }
  }
  const deps = [];
  const byLeaf = new Map<string, number[]>();
  tasks.forEach((t, i) => {
    if (!byLeaf.has(t.wbsCode)) byLeaf.set(t.wbsCode, []);
    byLeaf.get(t.wbsCode)!.push(i);
  });
  const targetEdges = Math.round(tasks.length * density);
  for (const arr of byLeaf.values())
    for (let i = 0; i + 1 < arr.length; i++)
      deps.push(makeDep(tasks[arr[i]].id, tasks[arr[i + 1]].id, {}, 'デモ生成'));
  // 追加の依存は「同じトップWBS(工区)内・近接インデックス」に限定する。工区を跨ぐランダムな
  // 長距離エッジを作らない＝グラフがクモの巣化せず、絞り込んだ範囲が疎に保たれる（実プロジェクト的）。
  let guard = 0;
  const seen = new Set(deps.map((d) => d.predecessorId + '>' + d.successorId));
  const top = (i: number) => tasks[i].wbsCode.split('.')[0];
  while (deps.length < targetEdges && guard < targetEdges * 8) {
    guard++;
    const i = Math.floor(rnd() * (tasks.length - 1));
    const j = Math.min(tasks.length - 1, i + 1 + Math.floor(rnd() * 5));
    if (j <= i) continue;
    if (top(i) !== top(j)) continue; // 工区を跨がない
    const key = tasks[i].id + '>' + tasks[j].id;
    if (seen.has(key)) continue;
    seen.add(key);
    deps.push(makeDep(tasks[i].id, tasks[j].id, {}, 'デモ生成'));
  }
  doc.tasks = tasks;
  doc.dependencies = deps;
  doc.viewState = { collapsedWbs: collapsedForLevel(tasks, 2), expandLevel: 2 };
  return doc;
}

// スターター（起動時の小さなサンプル）。
export function starterDoc(): GraphDoc {
  const doc = emptyDoc('サンプルプロジェクト');
  const a = makeTask({ name: '基本設計', wbsCode: '1.1', discipline: 'E', status: 'IN_PROGRESS', progress: 40, assignee: '設計1課', position: { x: 60, y: 120 } });
  const b = makeTask({ name: '資材調達', wbsCode: '1.2', discipline: 'P', assignee: '調達課', position: { x: 320, y: 120 } });
  const c = makeTask({ name: '据付工事', wbsCode: '1.3', discipline: 'C', assignee: '施工管理課', position: { x: 580, y: 120 } });
  const m = makeTask({ name: '完成', wbsCode: '1.3', isMilestone: true, assignee: '施工管理課', position: { x: 840, y: 130 } });
  doc.tasks = [a, b, c, m];
  doc.dependencies = [makeDep(a.id, b.id), makeDep(b.id, c.id), makeDep(c.id, m.id)];
  return doc;
}
