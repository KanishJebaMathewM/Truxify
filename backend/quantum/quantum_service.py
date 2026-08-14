import json
import networkx as nx
import numpy as np
from typing import Dict, List, Any, Optional
from datetime import datetime
import logging
from quantum_circuit import QuantumCircuitDesigner, QUBOFormatter, QAOAOptimizer, HybridQuantumClassical

logger = logging.getLogger(__name__)

class QuantumService:
    """Quantum Computing Service for Route Optimization"""
    
    def __init__(self):
        self.circuit_designer = QuantumCircuitDesigner()
        self.qubo_formatter = QUBOFormatter()
        self.qaoa_optimizer = QAOAOptimizer()
        self.hybrid_optimizer = HybridQuantumClassical()
        
        logger.info("✅ Quantum Service initialized")
    
    def create_quantum_circuit(self, circuit_type: str = 'basic', num_qubits: int = 10) -> Dict:
        """Create quantum circuit"""
        try:
            if circuit_type == 'basic':
                circuit = self.circuit_designer.create_basic_circuit()
            elif circuit_type == 'qaoa':
                circuit = self.circuit_designer.create_qaoa_circuit()
            else:
                return {'success': False, 'error': 'Invalid circuit type'}
            
            # Run circuit
            result = self.circuit_designer.run_circuit(circuit)
            
            return {
                'success': True,
                'data': result,
                'circuit_type': circuit_type
            }
        except Exception as e:
            logger.error(f"Circuit creation failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def solve_route_optimization(self, nodes: List[Dict], edges: List[Dict]) -> Dict:
        """Solve route optimization using quantum computing"""
        try:
            # Build graph
            graph = nx.Graph()
            
            # Add nodes
            for node in nodes:
                graph.add_node(node['id'], **node)
            
            # Add edges
            for edge in edges:
                graph.add_edge(edge['source'], edge['target'], weight=edge.get('distance', 1))
            
            # Formulate QUBO
            qubo = self.qubo_formatter.formulate_route_optimization(graph)
            
            # Solve using QAOA
            result = self.qubo_formatter.solve_qubo(qubo)
            
            # Extract route
            route = self._extract_route(result, [node['id'] for node in nodes])

            if route is None:
                return {
                    'success': False,
                    'not_implemented': True,
                    'error': 'No connected route could be decoded from the QUBO solution',
                    'data': {
                        'route': None,
                        'objective': result.get('objective'),
                        'num_nodes': len(nodes),
                        'num_edges': len(edges)
                    }
                }

            return {
                'success': True,
                'data': {
                    'route': route,
                    'objective': result.get('objective'),
                    'num_nodes': len(nodes),
                    'num_edges': len(edges)
                }
            }
        except Exception as e:
            logger.error(f"Route optimization failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def _extract_route(self, qubo_result: Dict, node_ids: List) -> List:
        """Decode the QUBO edge-selection solution into an ordered route"""
        solution = qubo_result.get('solution') or []
        variables = qubo_result.get('variables') or []
        if not solution or len(solution) != len(variables):
            return None

        selected = []
        for var, bit in zip(variables, solution):
            if bit and str(var).startswith('x_'):
                parts = str(var)[2:].split('_')
                if len(parts) == 2:
                    selected.append((parts[0], parts[1]))

        if not selected:
            return None

        adjacency = {}
        for u, v in selected:
            adjacency.setdefault(u, []).append(v)
            adjacency.setdefault(v, []).append(u)

        # Reject disconnected selections
        visited = set()
        stack = [selected[0][0]]
        while stack:
            current = stack.pop()
            if current in visited:
                continue
            visited.add(current)
            stack.extend(adjacency.get(current, []))
        if len(visited) != len(adjacency):
            return None

        # Order the selected edges into a traversal
        route = []
        stack = [selected[0][0]]
        remaining = list(selected)
        while stack:
            u = stack[-1]
            edge = next((e for e in remaining if u in e), None)
            if edge is None:
                route.append(stack.pop())
            else:
                remaining.remove(edge)
                v = edge[1] if edge[0] == u else edge[0]
                stack.append(v)

        # Map decoded node ids back to the original node id values
        id_map = {str(nid): nid for nid in node_ids}
        return [id_map.get(node, node) for node in route]
    
    def run_qaoa(self, cost_function: Any = None) -> Dict:
        """Run QAOA optimization"""
        try:
            result = self.qaoa_optimizer.optimize(cost_function)
            return {
                'success': True,
                'data': result
            }
        except Exception as e:
            logger.error(f"QAOA run failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def hybrid_optimize(self, problem: Dict) -> Dict:
        """Run hybrid classical-quantum optimization"""
        try:
            result = self.hybrid_optimizer.solve(problem)
            return {
                'success': True,
                'data': result
            }
        except Exception as e:
            logger.error(f"Hybrid optimization failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_stats(self) -> Dict:
        """Get quantum service statistics"""
        return {
            'circuit_designer': {
                'num_qubits': self.circuit_designer.num_qubits
            },
            'qaoa_optimizer': {
                'num_qubits': self.qaoa_optimizer.num_qubits,
                'reps': self.qaoa_optimizer.reps
            },
            'timestamp': datetime.now().isoformat()
        }