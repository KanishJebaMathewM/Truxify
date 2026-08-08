import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.preprocessing import StandardScaler
from typing import Dict, List, Tuple, Any, Optional
import networkx as nx
import logging
from datetime import datetime
import matplotlib.pyplot as plt
from causalnex.structure import StructureModel
from causalnex.structure.notears import from_pandas
from causalnex.inference import InferenceEngine
from causalnex.evaluation import evaluation
from dowhy import CausalModel
import warnings
warnings.filterwarnings('ignore')

logger = logging.getLogger(__name__)

class CausalDiscovery:
    """Discover causal relationships from logistics data"""
    
    def __init__(self):
        self.structure_model = None
        self.inference_engine = None
        self.causal_graph = nx.DiGraph()
        
        logger.info("✅ Causal Discovery initialized")
    
    def discover_causal_graph(self, data: pd.DataFrame, method: str = 'notears') -> nx.DiGraph:
        """Discover causal graph from data"""
        try:
            if method == 'notears':
                # Use NOTEARS algorithm
                self.structure_model = from_pandas(data, tabu_edges=[], max_iter=100)
                self.causal_graph = self.structure_model.to_nx()
            else:
                # Use PC algorithm
                from causalnex.structure import PC
                pc = PC()
                self.structure_model = pc.learn(data)
                self.causal_graph = self.structure_model.to_nx()
            
            logger.info(f"✅ Causal graph discovered with {len(self.causal_graph.nodes)} nodes")
            return self.causal_graph
            
        except Exception as e:
            logger.error(f"Causal discovery failed: {e}")
            return nx.DiGraph()
    
    def identify_causes(self, target_variable: str) -> List[str]:
        """Identify direct causes of target variable"""
        causes = []
        for node in self.causal_graph.predecessors(target_variable):
            causes.append(node)
        return causes
    
    def identify_effects(self, source_variable: str) -> List[str]:
        """Identify direct effects of source variable"""
        effects = []
        for node in self.causal_graph.successors(source_variable):
            effects.append(node)
        return effects
    
    def get_causal_paths(self, source: str, target: str) -> List[List[str]]:
        """Find all causal paths from source to target"""
        paths = []
        for path in nx.all_simple_paths(self.causal_graph, source, target):
            paths.append(path)
        return paths
    
    def calculate_effect_strength(self, source: str, target: str) -> float:
        """Calculate causal effect strength"""
        # Use structural equation model
        if self.structure_model is not None:
            effect = self.structure_model.get_edge_strength(source, target)
            return effect
        return 0.0

class DoCalculus:
    """Do-calculus for intervention analysis"""
    
    def __init__(self):
        self.causal_model = None
        self.do_results = {}
        
        logger.info("✅ Do-Calculus initialized")
    
    def set_causal_model(self, data: pd.DataFrame, treatments: List[str], outcomes: List[str]):
        """Set up causal model for do-calculus"""
        self.causal_model = CausalModel(
            data=data,
            treatment=treatments,
            outcome=outcomes,
            graph=self._build_graph(treatments, outcomes, data)
        )
        logger.info("✅ Causal model set")

    def _build_graph(self, treatments: List[str], outcomes: List[str], data: pd.DataFrame) -> str:
        """Build graph structure using the real dataframe column names.

        The previous implementation hardcoded placeholder nodes named
        'treatment', 'outcome' and 'confounder', which never match the columns
        passed to set_causal_model. DoWhy resolves treatment/outcome variables
        by name, so identification always failed and every estimate silently
        returned None. Any column that is neither a treatment nor an outcome is
        treated as a potential common cause (confounder) of treatment/outcome.
        """
        treatment_set = set(treatments)
        outcome_set = set(outcomes)
        confounders = [c for c in data.columns if c not in treatment_set and c not in outcome_set]

        lines = []
        for treatment in treatments:
            for outcome in outcomes:
                lines.append(f"    {treatment} -> {outcome};")
        for confounder in confounders:
            for treatment in treatments:
                lines.append(f"    {confounder} -> {treatment};")
            for outcome in outcomes:
                lines.append(f"    {confounder} -> {outcome};")

        return "digraph {\n" + "\n".join(lines) + "\n}"
    
    def estimate_ate(self, treatment: str, outcome: str) -> Dict:
        """Estimate Average Treatment Effect"""
        try:
            identified_estimand = self.causal_model.identify_effect()
            estimate = self.causal_model.estimate_effect(
                identified_estimand,
                method_name="backdoor.propensity_score_weighting"
            )
            
            return {
                'treatment': treatment,
                'outcome': outcome,
                'ate': estimate.value,
                'effect_size': 'large' if abs(estimate.value) > 0.5 else 'medium' if abs(estimate.value) > 0.2 else 'small',
                'confidence_interval': estimate.get_confidence_intervals() if hasattr(estimate, 'get_confidence_intervals') else None,
                'method': 'backdoor.propensity_score_weighting'
            }
        except Exception as e:
            logger.error(f"ATE estimation failed: {e}")
            return None
    
    def estimate_cate(self, treatment: str, outcome: str, features: List[str]) -> Dict:
        """Estimate the Average Treatment Effect (ATE).

        DoWhy's ``backdoor.propensity_score_weighting`` with ``target_units="ate"`
        produces a single population-level ATE, NOT a Conditional Average
        Treatment Effect (CATE). The result is therefore returned under an honest
        ``ate`` key. ``features`` is retained for API compatibility; it does not
        condition the estimate, so callers must not interpret the value as a CATE.
        """
        try:
            identified_estimand = self.causal_model.identify_effect()
            estimate = self.causal_model.estimate_effect(
                identified_estimand,
                method_name="backdoor.propensity_score_weighting",
                target_units="ate"
            )

            return {
                'treatment': treatment,
                'outcome': outcome,
                'ate': estimate.value,
                'features': features,
            }
        except Exception as e:
            logger.error(f"ATE estimation failed: {e}")
            return None

    def estimate_ite(self, treatment: str, outcome: str) -> Dict:
        """Estimate the Average Treatment effect on the Treated (ATT).

        ``target_units="att"`` produces a single aggregate ATT, not per-unit
        Individual Treatment Effects, so the result is returned under an honest
        ``att`` key. Callers that need true ITE must use per-unit/subpopulation
        estimation instead.
        """
        try:
            identified_estimand = self.causal_model.identify_effect()
            estimate = self.causal_model.estimate_effect(
                identified_estimand,
                method_name="backdoor.propensity_score_weighting",
                target_units="att"
            )

            return {
                'treatment': treatment,
                'outcome': outcome,
                'att': estimate.value,
            }
        except Exception as e:
            logger.error(f"ATT estimation failed: {e}")
            return None

class CausalImpact:
    """Measure causal impact of interventions"""
    
    def __init__(self):
        self.impact_results = {}
        
        logger.info("✅ Causal Impact initialized")
    
    def measure_impact(self, pre_data: np.ndarray, post_data: np.ndarray, intervention_point: int) -> Dict:
        """Measure impact of intervention"""
        # The causalimpact library expects a single full data series with
        # period indices that point into it, so the pre- and post-intervention
        # arrays are combined into one series before analysis.
        data = np.concatenate([pre_data, post_data])

        # Reject intervention points outside the combined pre/post series so
        # callers get an explicit error instead of a silently-null result.
        if intervention_point < 0 or intervention_point >= len(data):
            raise ValueError(
                f"intervention_point {intervention_point} is outside the "
                f"combined pre/post series of length {len(data)}"
            )

        try:
            # Pre-intervention period
            pre_period = [0, intervention_point - 1]
            post_period = [intervention_point, len(data) - 1]
            
            # Calculate counterfactual
            from causalimpact import CausalImpact
            
            impact = CausalImpact(data, pre_period, post_period)
            impact.run()
            
            summary = impact.summary()
            report = impact.report()
            
            return {
                'absolute_effect': summary.get('absolute_effect', 0),
                'relative_effect': summary.get('relative_effect', 0),
                'p_value': summary.get('p_value', 1.0),
                'confidence_interval': summary.get('confidence_interval', [0, 0]),
                'summary': summary,
                'report': report
            }
        except Exception as e:
            logger.error(f"Causal impact measurement failed: {e}")
            return None
    
    def calculate_lift(self, pre: float, post: float) -> Dict:
        """Calculate lift from intervention"""
        lift = ((post - pre) / pre) * 100 if pre != 0 else 0
        
        return {
            'pre_value': pre,
            'post_value': post,
            'lift_percentage': lift,
            'improvement': 'positive' if lift > 0 else 'negative' if lift < 0 else 'neutral'
        }

class BottleneckAnalyzer:
    """Root cause analysis for logistics bottlenecks"""
    
    def __init__(self):
        self.bottlenecks = []
        self.root_causes = {}
        
        logger.info("✅ Bottleneck Analyzer initialized")
    
    def identify_bottlenecks(self, data: pd.DataFrame, metrics: List[str]) -> List[Dict]:
        """Identify bottlenecks in logistics operations"""
        bottlenecks = []
        
        for metric in metrics:
            if metric in data.columns:
                # Calculate threshold (75th percentile)
                threshold = data[metric].quantile(0.75)
                
                # Identify high values
                high_values = data[data[metric] > threshold]
                
                if len(high_values) > 0:
                    bottlenecks.append({
                        'metric': metric,
                        'threshold': threshold,
                        'count': len(high_values),
                        'percentage': (len(high_values) / len(data)) * 100,
                        'average_value': high_values[metric].mean(),
                        'max_value': high_values[metric].max()
                    })
        
        self.bottlenecks = bottlenecks
        return bottlenecks
    
    def find_root_causes(self, bottleneck: Dict, causal_graph: nx.DiGraph) -> List[Dict]:
        """Find root causes of bottleneck"""
        root_causes = []
        
        # Find all ancestors in causal graph
        target = bottleneck['metric']
        ancestors = nx.ancestors(causal_graph, target)
        
        for ancestor in ancestors:
            root_causes.append({
                'cause': ancestor,
                'type': 'direct' if ancestor in causal_graph.predecessors(target) else 'indirect',
                'path_length': len(nx.shortest_path(causal_graph, ancestor, target)) if nx.has_path(causal_graph, ancestor, target) else 0
            })
        
        self.root_causes[target] = root_causes
        return root_causes
    
    def generate_recommendations(self, root_causes: List[Dict]) -> List[str]:
        """Generate recommendations based on root causes"""
        recommendations = []
        
        for cause in root_causes:
            if cause['type'] == 'direct':
                recommendations.append(f"Address direct cause: {cause['cause']}")
            else:
                recommendations.append(f"Consider indirect cause: {cause['cause']} (path length: {cause['path_length']})")
        
        return recommendations

class CausalInferenceService:
    """Main Causal Inference Service"""
    
    def __init__(self):
        self.causal_discovery = CausalDiscovery()
        self.do_calculus = DoCalculus()
        self.causal_impact = CausalImpact()
        self.bottleneck_analyzer = BottleneckAnalyzer()
        
        logger.info("✅ Causal Inference Service initialized")
    
    def analyze_logistics_data(self, data: pd.DataFrame, target_metric: str) -> Dict:
        """Complete causal analysis of logistics data"""
        try:
            # Step 1: Discover causal graph
            causal_graph = self.causal_discovery.discover_causal_graph(data)
            
            # Step 2: Identify causes
            causes = self.causal_discovery.identify_causes(target_metric)
            
            # Step 3: Set up causal model
            self.do_calculus.set_causal_model(data, causes, [target_metric])
            
            # Step 4: Estimate treatment effects
            ate_results = []
            for cause in causes:
                if cause != target_metric:
                    ate = self.do_calculus.estimate_ate(cause, target_metric)
                    if ate:
                        ate_results.append(ate)
            
            # Step 5: Identify bottlenecks
            bottlenecks = self.bottleneck_analyzer.identify_bottlenecks(data, [target_metric])
            
            # Step 6: Find root causes
            root_causes = []
            for bottleneck in bottlenecks:
                rc = self.bottleneck_analyzer.find_root_causes(bottleneck, causal_graph)
                root_causes.extend(rc)
            
            # Step 7: Generate recommendations
            recommendations = self.bottleneck_analyzer.generate_recommendations(root_causes)
            
            return {
                'success': True,
                'causal_graph': {
                    'nodes': list(causal_graph.nodes()),
                    'edges': list(causal_graph.edges()),
                    'edges_count': len(causal_graph.edges())
                },
                'causes': causes,
                'treatment_effects': ate_results,
                'bottlenecks': bottlenecks,
                'root_causes': root_causes,
                'recommendations': recommendations,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Analysis failed: {e}")
            return {'success': False, 'error': str(e)}