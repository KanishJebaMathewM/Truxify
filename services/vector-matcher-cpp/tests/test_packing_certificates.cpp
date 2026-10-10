#include "matcher.hpp"
#include <algorithm>
#include <array>
#include <cmath>
#include <iostream>
#include <limits>
#include <stdexcept>
#include <vector>
using namespace TruxifyMatcher;
size_t controls=0;
void require(bool condition){++controls;if(!condition)throw std::runtime_error("certificate control failed");}
// Independent error-free TwoSum comparison; production uses paired subtraction.
bool sumAtMost(float a, float b, float c) {
    const double sum = double(a) + double(b);
    const double virtualB = sum - double(a);
    const double error = (double(a) - (sum - virtualB)) + (double(b) - virtualB);
    return sum < double(c) || (sum == double(c) && error <= 0);
}
void certificate(const VectorMatchResult&r,const Box3D&bed,size_t count){
 require(r.fits && r.status==PackingStatus::Packed);
 require(r.packedCount==count && r.placementMap.size()==count);
 require(std::isfinite(r.utilizationPercentage) && r.utilizationPercentage>=0 && r.utilizationPercentage<=100);
 for(const auto&p:r.placementMap){
  require(p.x>=0 && p.y>=0 && p.z>=0);
  require(sumAtMost(p.x,p.box.length,bed.length));
  require(sumAtMost(p.y,p.box.width,bed.width));
  require(sumAtMost(p.z,p.box.height,bed.height));
 }
 for(size_t i=0;i<count;++i)for(size_t j=0;j<i;++j){
  const auto&a=r.placementMap[i];const auto&b=r.placementMap[j];
  require(sumAtMost(a.x,a.box.length,b.x) || sumAtMost(b.x,b.box.length,a.x) ||
          sumAtMost(a.y,a.box.width,b.y) || sumAtMost(b.y,b.box.width,a.y) ||
          sumAtMost(a.z,a.box.height,b.z) || sumAtMost(b.z,b.box.height,a.z));
 }
}
int main(){
 require(!sumAtMost(std::numeric_limits<float>::denorm_min(),std::numeric_limits<float>::max(),std::numeric_limits<float>::max()));
 require(!sumAtMost(std::numeric_limits<float>::max(),std::numeric_limits<float>::denorm_min(),std::numeric_limits<float>::max()));
 require(sumAtMost(0,std::numeric_limits<float>::max(),std::numeric_limits<float>::max()));
 const float inf=std::numeric_limits<float>::infinity(),nan=std::numeric_limits<float>::quiet_NaN();
 for(float bad:{-1.f,0.f,inf,-inf,nan})for(int axis=0;axis<3;++axis){
  Box3D shape{2,2,2};std::array<float*,3> fields{&shape.length,&shape.width,&shape.height};*fields[axis]=bad;
  auto bed=VectorMatcherEngine::evaluatePackingAVX(shape,{{1,1,1}});
  require(!bed.fits && bed.status==PackingStatus::InvalidInput && bed.packedCount==0 && bed.placementMap.empty());
  auto cargo=VectorMatcherEngine::evaluatePackingAVX({2,2,2},{{1,1,1},shape});
  require(!cargo.fits && cargo.status==PackingStatus::InvalidInput && cargo.packedCount==0 && cargo.placementMap.empty());
 }
 for(float scale:{std::numeric_limits<float>::denorm_min(),1e-20f,1e-5f,1.f,1e20f,std::numeric_limits<float>::max()}){
  Box3D bed{scale,scale,scale};auto r=VectorMatcherEngine::evaluatePackingAVX(bed,{bed});
  certificate(r,bed,1);require(r.utilizationPercentage==100);
  auto oversized=bed;oversized.length=std::nextafter(scale,inf);
  if(std::isfinite(oversized.length)){
   auto rejected=VectorMatcherEngine::evaluatePackingAVX(bed,{oversized});
   require(!rejected.fits && rejected.status==PackingStatus::Infeasible);
  }
 }
 for(int exponent=-100;exponent<=100;exponent+=5){
  const float scale=std::ldexp(1.f,exponent);Box3D bed{4*scale,4*scale,4*scale};
  std::vector<Box3D> mixed{{2*scale,scale,2*scale},{scale,2*scale,scale},{3*scale,3*scale,3*scale}};
  auto r=VectorMatcherEngine::evaluatePackingAVX(bed,mixed);certificate(r,bed,3);
  require(std::abs(r.utilizationPercentage-51.5625f)<1e-5);
  std::vector<Box3D> cubes(8,{2*scale,2*scale,2*scale});
  auto tiled=VectorMatcherEngine::evaluatePackingAVX(bed,cubes);certificate(tiled,bed,8);require(tiled.utilizationPercentage==100);
 }
 // A positive offset is absorbed even in double addition to float max.
 // The second full-width box cannot fit behind the subnormal first box.
 auto absorbed=VectorMatcherEngine::evaluatePackingAVX({std::numeric_limits<float>::max(),1,1},
   {{std::numeric_limits<float>::denorm_min(),1,1},{std::numeric_limits<float>::max(),1,1}});
 require(!absorbed.fits && absorbed.status==PackingStatus::Infeasible && absorbed.placementMap.empty());
 auto tolerance=VectorMatcherEngine::evaluatePackingAVX({1e-5f,1e-5f,1e-5f},{{1e-4f,1e-4f,1e-4f}});
 require(!tolerance.fits && tolerance.status==PackingStatus::Infeasible);
 certificate(VectorMatcherEngine::evaluatePackingAVX({1,1,1},{}),{1,1,1},0);
 PackingLimits limits;limits.maxBoxes=1;
 require(VectorMatcherEngine::evaluatePackingAVX({2,2,2},{{1,1,1},{1,1,1}},limits).status==PackingStatus::ResourceLimit);
 limits=PackingLimits{};limits.maxCoordinateProducts=1;
 require(VectorMatcherEngine::evaluatePackingAVX({2,2,2},{{1,1,1},{1,1,1}},limits).status==PackingStatus::ResourceLimit);
 limits=PackingLimits{};limits.maxCandidateChecks=1;
 require(VectorMatcherEngine::evaluatePackingAVX({2,2,2},{{1,1,1},{1,1,1}},limits).status==PackingStatus::ResourceLimit);
 limits=PackingLimits{};limits.maxOverlapChecks=1;
 require(VectorMatcherEngine::evaluatePackingAVX({2,2,2},{{1,1,1},{1,1,1}},limits).status==PackingStatus::ResourceLimit);
 limits=PackingLimits{};limits.maxBoxes=0;
 require(VectorMatcherEngine::evaluatePackingAVX({1,1,1},{},limits).status==PackingStatus::InvalidInput);
 limits=PackingLimits{};limits.maxCoordinateProducts=std::numeric_limits<size_t>::max();
 require(VectorMatcherEngine::evaluatePackingAVX({1,1,1},{},limits).status==PackingStatus::InvalidInput);
 std::cout<<controls<<" independent native certificate controls passed\n";
}
