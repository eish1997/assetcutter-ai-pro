/** 供应商无关计量中间表示（L2 管线输入） */

export type MeterModality = 'text' | 'image' | '3d' | 'video' | 'task';

export type MeterPartKind = 'input_token' | 'output_token' | 'output_image' | 'task' | 'second';

export type MeterPart = {
  kind: MeterPartKind;
  quantity: number;
  unit: string;
};

export type MeterConfidence = 'exact' | 'estimated';

export type MeterReading = {
  provider: string;
  modality: MeterModality;
  parts: MeterPart[];
  rawUsage?: unknown;
  confidence: MeterConfidence;
};
