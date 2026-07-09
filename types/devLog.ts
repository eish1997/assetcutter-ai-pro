export type DevLogCommit = {
  sha: string;
  subject: string;
};

export type DevLogStats = {
  filesChanged: number;
  insertions: number;
  deletions: number;
};

export type DevLogEntry = {
  id: string;
  dayKey: string;
  pushedAt: string;
  fromSha: string;
  toSha: string;
  summaryBullets: string[];
  commits: DevLogCommit[];
  stats: DevLogStats;
};

export type DevLogDayIndex = {
  dayKey: string;
  entryIds: string[];
};

export type DevLogIndex = {
  updatedAt: string;
  lastPushSha: string;
  days: DevLogDayIndex[];
};
