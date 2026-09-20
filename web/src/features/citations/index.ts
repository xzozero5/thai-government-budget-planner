/** T-407 — barrel export ของ `features/citations/*` */

export { CitationChip } from '@/features/citations/CitationChip';
export type { CitationChipProps } from '@/features/citations/CitationChip';

export { CitationDrawer } from '@/features/citations/CitationDrawer';
export type {
  CitationDrawerLoaders,
  CitationDrawerProps,
  DocumentChunkView,
  EconPointView,
} from '@/features/citations/CitationDrawer';

export {
  datasetTypeLabel,
  describeQualityFlag,
  econIndicatorLabelTh,
  formatCitationDate,
  getCitationChipLabel,
  getWebDomain,
  isHttpsUrl,
} from '@/features/citations/citationLabel';
export type {
  BudgetLineChipHint,
  CitationChipLabelOptions,
  QualityFlagDisplay,
} from '@/features/citations/citationLabel';

export {
  createBudgetLineLoaders,
  loadDocumentChunkFromData,
  loadEconPointFromData,
} from '@/features/citations/dataCitationLoaders';
export type { BudgetLineCitationLoaders } from '@/features/citations/dataCitationLoaders';
