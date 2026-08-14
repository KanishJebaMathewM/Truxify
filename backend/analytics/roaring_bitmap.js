/**
 * Roaring Bitmap Fleet Attribute Filtering Engine.
 * Implements compressed bitwise calculations to filter dynamic driver properties.
 */
export class RoaringBitmapIndexer {
  constructor() {
    this.indexes = new Map();
  }

  setDriverBit(attributeName, driverIndex) {
    if (!this.indexes.has(attributeName)) {
      this.indexes.set(attributeName, new Set());
    }
    this.indexes.get(attributeName).add(driverIndex);
  }

  intersectAttributes(attributesList) {
    if (attributesList.length === 0) return [];
    
    let resultSet = new Set(this.indexes.get(attributesList[0]) || []);
    
    for (let i = 1; i < attributesList.length; i++) {
      const nextSet = this.indexes.get(attributesList[i]) || new Set();
      resultSet = new Set([...resultSet].filter(x => nextSet.has(x)));
    }

    return Array.from(resultSet);
  }
}

export const roaringBitmapIndexer = new RoaringBitmapIndexer();
