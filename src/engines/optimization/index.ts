export {
  EngagementAnalyzer,
  PlatformMetricsClient,
  RawPlatformMetrics,
  calculateEngagementRate,
} from './engagement-analyzer';

export {
  BoostRecommender,
  BoostRecommenderConfig,
  calculatePerformanceScore,
  calculateExpectedRoi,
  meetsBoostThreshold,
} from './boost-recommender';

export {
  GoogleAdsClient,
  GoogleAdsApi,
  resolveBidStrategy,
  buildAdTargeting,
} from './google-ads-client';

export {
  InstagramAdsClient,
  InstagramAdsApi,
  CreativeUploadResult,
  resolveInstagramBidStrategy,
  buildInstagramAdTargeting,
} from './instagram-ads-client';

export {
  BudgetOptimizer,
  BudgetOptimizerConfig,
  PerformanceData,
  CampaignAllocation,
  BudgetAllocation,
  BudgetAlert,
  AlertSeverity,
  calculateRoiScore,
  generateAlerts,
} from './budget-optimizer';

export {
  ABTestingFramework,
  ABTestingConfig,
  ContentVariation,
  ABTestResult,
  TestGroup,
  VariationResult,
  MemberEngagement,
  EngagementSimulator,
  assignTestGroups,
  calculateChiSquared,
  chiSquaredPValue,
  selectWinner,
} from './ab-testing-framework';
