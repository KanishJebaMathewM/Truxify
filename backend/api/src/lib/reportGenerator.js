/**
 * @fileoverview Report generation utilities for PDF and Excel exports.
 * Generates fleet analytics reports without heavy external dependencies.
 */

import logger from '../middleware/logger.js';

/**
 * Generates a CSV string from analytics data.
 * @param {object[]} data - Array of row objects
 * @param {string[]} columns - Columns to include
 * @returns {string} CSV content
 */
export function generateCSV(data, columns) {
    if (!data || data.length === 0) return '';

    const headers = columns || Object.keys(data[0]);
    const rows = [headers.join(',')];

    for (const row of data) {
        const values = headers.map(col => {
            let val = row[col];
            if (val === null || val === undefined) val = '';

            // Escape quotes and wrap in quotes if contains comma
            val = String(val);
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
                val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
        });
        rows.push(values.join(','));
    }

    return rows.join('\n');
}

/**
 * Generates a simple HTML report that can be printed to PDF.
 * @param {object} reportData 
 * @returns {string} HTML content
 */
export function generateHTMLReport(reportData) {
    const { title, generatedAt, summary, tables } = reportData;

    let html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #2563eb; border-bottom: 2px solid #2563eb; padding-bottom: 10px; }
    h2 { color: #1e40af; margin-top: 30px; }
    .summary { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
    .metric { text-align: center; }
    .metric-value { font-size: 24px; font-weight: bold; color: #2563eb; }
    .metric-label { font-size: 12px; color: #6b7280; text-transform: uppercase; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    tr:hover { background: #f9fafb; }
    .footer { margin-top: 40px; text-align: center; color: #9ca3af; font-size: 12px; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated: ${new Date(generatedAt).toLocaleString()}</p>
  
  <div class="summary">
    <h2>Summary</h2>
    <div class="summary-grid">
  `;

    if (summary) {
        for (const [key, value] of Object.entries(summary)) {
            html += `
      <div class="metric">
        <div class="metric-value">${value}</div>
        <div class="metric-label">${key}</div>
      </div>
      `;
        }
    }

    html += `
    </div>
  </div>
  `;

    if (tables && tables.length > 0) {
        for (const table of tables) {
            html += `<h2>${table.title}</h2>`;
            html += `<table><thead><tr>`;

            for (const col of table.columns) {
                html += `<th>${col.label}</th>`;
            }
            html += `</tr></thead><tbody>`;

            for (const row of table.data) {
                html += `<tr>`;
                for (const col of table.columns) {
                    let val = row[col.key];
                    if (col.format === 'currency') val = `₹${(val / 100).toFixed(2)}`;
                    if (col.format === 'percent') val = `${val}%`;
                    html += `<td>${val !== undefined ? val : '-'}</td>`;
                }
                html += `</tr>`;
            }
            html += `</tbody></table>`;
        }
    }

    html += `
  <div class="footer">
    <p>Truxify Fleet Analytics Report | Confidential</p>
  </div>
</body>
</html>
  `;

    return html;
}

/**
 * Formats metrics for dashboard display.
 * @param {object} rawMetrics 
 * @returns {object}
 */
export function formatDashboardMetrics(rawMetrics) {
    return {
        fleetOverview: {
            totalDrivers: rawMetrics.totalDrivers || 0,
            activeDrivers: rawMetrics.activeDrivers || 0,
            utilizationRate: rawMetrics.utilizationPct || 0
        },
        performance: {
            onTimeDeliveryPct: rawMetrics.onTimePct || 0,
            averageRating: rawMetrics.averageRating || 0,
            totalTrips: rawMetrics.totalTrips || 0
        },
        financial: {
            totalRevenuePaisa: rawMetrics.totalRevenue || 0,
            totalFuelCostPaisa: rawMetrics.totalFuelCost || 0,
            netProfitPaisa: (rawMetrics.totalRevenue || 0) - (rawMetrics.totalFuelCost || 0)
        }
    };
}
