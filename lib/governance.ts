export const DIALECTS = ["未標示", "四縣", "海陸", "大埔", "饒平", "詔安", "南四縣"] as const;
export const ACCESS_LEVELS = ["public", "community", "restricted"] as const;
export const RIGHTS_BASES = ["本人創作", "已取得授權", "公有領域", "合理引用", "待確認"] as const;

export type DialectTag = typeof DIALECTS[number];
export type AccessLevel = typeof ACCESS_LEVELS[number];
export type RightsBasis = typeof RIGHTS_BASES[number];

export type GovernanceMetadata = {
  dialect: DialectTag;
  rightsHolder: string;
  rightsBasis: RightsBasis;
  license: string;
  accessLevel: AccessLevel;
  communityBenefit: string;
  consentConfirmed: boolean;
};

export const REVIEW_GATE_KEYS = [
  "groundedness",
  "citationFidelity",
  "dialectIntegrity",
  "culturalSafety",
  "scopeDiscipline",
  "literaryIntegrity",
] as const;

export type ReviewGateKey = typeof REVIEW_GATE_KEYS[number];
export type ReviewGates = Record<ReviewGateKey, boolean>;

export const EMPTY_REVIEW_GATES: ReviewGates = {
  groundedness: false,
  citationFidelity: false,
  dialectIntegrity: false,
  culturalSafety: false,
  scopeDiscipline: false,
  literaryIntegrity: false,
};

export const REVIEW_GATE_LABELS: Record<ReviewGateKey, string> = {
  groundedness: "內容可由證據支持，無未支撐主張",
  citationFidelity: "來源、作者與權利資訊保留正確",
  dialectIntegrity: "指定腔別的用詞與語言品質合宜",
  culturalSafety: "文化意義、禁忌與社群脈絡獲得尊重",
  scopeDiscipline: "資料不足時能克制回答並正確轉介",
  literaryIntegrity: "沒有抄襲或模仿可辨識作者風格",
};

export const ACCESS_LABELS: Record<AccessLevel, string> = {
  public: "公開使用",
  community: "社群限定",
  restricted: "受限保存",
};

export function defaultGovernance(): GovernanceMetadata {
  return {
    dialect: "未標示",
    rightsHolder: "未標示",
    rightsBasis: "待確認",
    license: "未標示",
    accessLevel: "public",
    communityBenefit: "客家知識保存、教育與研究",
    consentConfirmed: false,
  };
}

export function normalizeGovernance(value: unknown): GovernanceMetadata {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const dialect = DIALECTS.includes(input.dialect as DialectTag)
    ? input.dialect as DialectTag
    : "未標示";
  const rightsBasis = RIGHTS_BASES.includes(input.rightsBasis as RightsBasis)
    ? input.rightsBasis as RightsBasis
    : "待確認";
  const accessLevel = ACCESS_LEVELS.includes(input.accessLevel as AccessLevel)
    ? input.accessLevel as AccessLevel
    : "public";
  return {
    dialect,
    rightsHolder: String(input.rightsHolder || "未標示").trim().slice(0, 160),
    rightsBasis,
    license: String(input.license || "未標示").trim().slice(0, 160),
    accessLevel,
    communityBenefit: String(input.communityBenefit || "客家知識保存、教育與研究").trim().slice(0, 500),
    consentConfirmed: input.consentConfirmed === true || input.consentConfirmed === 1,
  };
}

export function normalizeReviewGates(value: unknown): ReviewGates {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return REVIEW_GATE_KEYS.reduce((result, key) => {
    result[key] = input[key] === true || input[key] === 1;
    return result;
  }, { ...EMPTY_REVIEW_GATES });
}

export function allReviewGatesPassed(gates: ReviewGates) {
  return REVIEW_GATE_KEYS.every((key) => gates[key]);
}

export function governanceFromRow(row: Record<string, unknown>): GovernanceMetadata {
  return normalizeGovernance({
    dialect: row.dialect,
    rightsHolder: row.rights_holder,
    rightsBasis: row.rights_basis,
    license: row.license,
    accessLevel: row.access_level,
    communityBenefit: row.community_benefit,
    consentConfirmed: row.consent_confirmed,
  });
}
