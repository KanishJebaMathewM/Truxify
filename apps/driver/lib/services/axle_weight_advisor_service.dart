import 'dart:async';
import '../models/axle_weight_advisor_model.dart';

class AxleWeightAdvisorService {
  Future<ScaleWeightReceipt> processScaleTicketOCR() async {
    // Simulate OCR delay
    await Future.delayed(const Duration(seconds: 2));

    // Simulated non-compliant weight: 
    // Gross is legal (78,000), but trailer is overloaded (35,500)
    // Drive is underloaded (31,500)
    return ScaleWeightReceipt(
      steerAxleWeightLbs: 11000.0,
      driveAxleWeightLbs: 31500.0,
      trailerAxleWeightLbs: 35500.0, 
      grossWeightLbs: 78000.0,
    );
  }

  Future<WeightAdjustmentAdvice> calculateAdjustment(ScaleWeightReceipt receipt) async {
    await Future.delayed(const Duration(seconds: 1));

    // Simple physics logic for demo: sliding tandems 1 hole shifts ~400 lbs
    // Trailer is 1,500 lbs over the 34,000 limit. 
    // Need to shift 1,500 lbs to the drives -> 1500 / 400 = 3.75 holes (round to 4)
    // To move weight from trailer to drives, slide tandems FORWARD (toward the cab).
    
    return WeightAdjustmentAdvice(
      isCompliant: false,
      instruction: 'Slide trailer tandems FORWARD by 4 holes toward the cab.',
      holesToSlide: 4,
      slideDirection: 'Forward',
      estimatedDriveWeightLbs: 33100.0, // +1600
      estimatedTrailerWeightLbs: 33900.0, // -1600
    );
  }
}
