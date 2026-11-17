
/**
 * Roaring Bitmap Fleet Attribute Filtering Engine.
 * Provides efficient Set-based filtering for dynamic driver properties.
 */
export class RoaringBitmapIndexer {
  constructor() {
    this.indexes = new Map();
  }

  /**
   * Validate attribute name and driver index.
   */
  validateInput(attributeName, driverIndex) {
    if (
      typeof attributeName !== "string" ||
      !attributeName.trim()
    ) {
      throw new TypeError("Invalid attribute name");
    }

    if (
      !Number.isSafeInteger(driverIndex) ||
      driverIndex < 0
    ) {
      throw new TypeError("Invalid driver index");
    }
  }

  /**
   * Add a driver to an attribute index.
   */
  setDriverBit(attributeName, driverIndex) {
    this.validateInput(attributeName, driverIndex);

    if (!this.indexes.has(attributeName)) {
      this.indexes.set(attributeName, new Set());
    }

    this.indexes.get(attributeName).add(driverIndex);

    return this;
  }

  /**
   * Remove a driver from an attribute index.
   */
  removeDriverBit(attributeName, driverIndex) {
    this.validateInput(attributeName, driverIndex);

    const drivers = this.indexes.get(attributeName);

    if (!drivers) return false;

    const removed = drivers.delete(driverIndex);

    if (drivers.size === 0) {
      this.indexes.delete(attributeName);
    }

    return removed;
  }

  /**
   * Find drivers matching ALL specified attributes.
   */
  intersectAttributes(attributesList) {
    if (!Array.isArray(attributesList)) {
      throw new TypeError("Attributes must be an array");
    }

    if (attributesList.length === 0) return [];

    const uniqueAttributes = [...new Set(attributesList)];

    if (
      uniqueAttributes.some(
        attribute =>
          typeof attribute !== "string" ||
          !attribute.trim()
      )
    ) {
      throw new TypeError("Invalid attribute name");
    }

    // Sort by smallest Set first.
    const sortedSets = uniqueAttributes
      .map(attribute => this.indexes.get(attribute))
      .sort((a, b) => (a?.size || 0) - (b?.size || 0));

    if (!sortedSets[0] || sortedSets[0].size === 0) {
      return [];
    }

    const result = [];

    for (const driverIndex of sortedSets[0]) {
      if (
        sortedSets.every(
          drivers => drivers?.has(driverIndex)
        )
      ) {
        result.push(driverIndex);
      }
    }

    return result;
  }

  /**
   * Find drivers matching ANY specified attribute.
   */
  unionAttributes(attributesList) {
    if (!Array.isArray(attributesList)) {
      throw new TypeError("Attributes must be an array");
    }

    const result = new Set();

    for (const attribute of attributesList) {
      const drivers = this.indexes.get(attribute);

      if (drivers) {
        for (const driver of drivers) {
          result.add(driver);
        }
      }
    }

    return [...result];
  }

  /**
   * Find drivers belonging to the first attribute
   * but not the remaining attributes.
   */
  differenceAttributes(attributesList) {
    if (!Array.isArray(attributesList)) {
      throw new TypeError("Attributes must be an array");
    }

    if (attributesList.length === 0) return [];

    const firstSet = this.indexes.get(attributesList[0]);

    if (!firstSet) return [];

    const excluded = new Set();

    for (const attribute of attributesList.slice(1)) {
      const drivers = this.indexes.get(attribute);

      if (drivers) {
        for (const driver of drivers) {
          excluded.add(driver);
        }
      }
    }

    return [...firstSet].filter(
      driver => !excluded.has(driver)
    );
  }

  /**
   * Get all drivers for an attribute.
   */
  getDrivers(attributeName) {
    return [...(this.indexes.get(attributeName) || [])];
  }

  /**
   * Remove an entire attribute index.
   */
  removeAttribute(attributeName) {
    return this.indexes.delete(attributeName);
  }

  /**
   * Clear all indexes.
   */
  clear() {
    this.indexes.clear();
  }
}

export const roaringBitmapIndexer = new RoaringBitmapIndexer();
