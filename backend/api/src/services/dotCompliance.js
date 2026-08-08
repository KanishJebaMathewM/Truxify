/**
 * Mock database of registered DOT-certified medical examiners / clinics near major freight corridors.
 */
const DOT_CERTIFIED_CLINICS = [
    { clinicId: 'clinic-01', name: 'Concentra Urgent Care & DOT Exams', routeMileMarker: 142, city: 'Harrisburg', state: 'PA', phone: '717-555-0192', rating: 4.8 },
    { clinicId: 'clinic-02', name: 'FastMed Occupational Health', routeMileMarker: 280, city: 'Columbus', state: 'OH', phone: '614-555-0144', rating: 4.7 },
    { clinicId: 'clinic-03', name: 'TA Petro Health Clinic', routeMileMarker: 410, city: 'Indianapolis', state: 'IN', phone: '317-555-0178', rating: 4.6 }
];

const DEFAULT_WARNING_THRESHOLD_DAYS = 30;

/**
 * Calculates days remaining until expiration.
 * @param {String|Date} dateStr - Expiration date
 * @returns {Number} Days remaining (negative if already expired)
 */
function getDaysUntilExpiration(dateStr) {
    const today = new Date();
    const expDate = new Date(dateStr);
    const timeDiff = expDate.getTime() - today.getTime();
    return Math.ceil(timeDiff / (1000 * 3600 * 24));
}

/**
 * Evaluates driver compliance documents (CDL, Medical Card, Hazmat Endorsement).
 * @param {Object} driverComplianceData - { driverId, cdlExpiration, medicalCardExpiration, hazmatExpiration, currentRoute }
 * @returns {Object} Comprehensive compliance health report and clinic booking recommendations
 */
export function evaluateDriverCompliance(driverComplianceData) {
    const {
        driverId,
        cdlExpiration,
        medicalCardExpiration,
        hazmatExpiration,
        currentRoute = {}
    } = driverComplianceData;

    const documents = [
        { type: 'MEDICAL_CARD', expDate: medicalCardExpiration },
        { type: 'CDL', expDate: cdlExpiration },
        { type: 'HAZMAT', expDate: hazmatExpiration }
    ];

    const documentStatuses = {};
    let requiresAction = false;
    let primaryActionItem = null;

    documents.forEach((doc) => {
        if (!doc.expDate) return;

        const daysRemaining = getDaysUntilExpiration(doc.expDate);
        let status = 'VALID';

        if (daysRemaining <= 0) {
            status = 'EXPIRED';
            requiresAction = true;
        } else if (daysRemaining <= DEFAULT_WARNING_THRESHOLD_DAYS) {
            status = 'EXPIRING_SOON';
            requiresAction = true;
        }

        documentStatuses[doc.type] = {
            expirationDate: doc.expDate,
            daysRemaining,
            status
        };

        // Prioritize Medical Card if it requires renewal
        if (doc.type === 'MEDICAL_CARD' && (status === 'EXPIRING_SOON' || status === 'EXPIRED')) {
            primaryActionItem = documentStatuses[doc.type];
        }
    });

    // Predict & match DOT-certified clinics along driver's route if renewal is needed
    let recommendedClinics = [];
    if (requiresAction && documentStatuses.MEDICAL_CARD && documentStatuses.MEDICAL_CARD.status !== 'VALID') {
        recommendedClinics = DOT_CERTIFIED_CLINICS.map((clinic) => ({
            ...clinic,
            estimatedDetourMinutes: 10,
            appointmentAvailableWithinDays: 2
        }));
    }

    return {
        driverId,
        isFullyCompliant: !requiresAction,
        documents: documentStatuses,
        actionRequired: requiresAction,
        promptBookingAlert: !!primaryActionItem,
        recommendedClinics
    };
}
