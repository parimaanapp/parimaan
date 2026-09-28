import 'dart:typed_data';

import 'package:ferry/ferry.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/graphql/client.dart';
import '../../../shared/graphql/ferry_execute.dart';
import '../../../shared/graphql/operations/__generated__/analyze_pantry_photo.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/analyze_pantry_photo.req.gql.dart';
import '../../../shared/graphql/operations/__generated__/analyze_pantry_photo.var.gql.dart';
import '../../../shared/graphql/operations/__generated__/get_pantry_photo_upload_url.data.gql.dart';
import '../../../shared/graphql/operations/__generated__/get_pantry_photo_upload_url.req.gql.dart';
import '../../../shared/graphql/__generated__/schema.schema.gql.dart'
    show GProposalConfidence;
import '../domain/pantry_photo_analysis.dart';
import 'pantry_photo_uploader.dart';

/// Which half of the pipeline is running — lets the screen say "Uploading…"
/// and then "Analyzing…" over what can be a ~25s wait (W20 D2).
enum PhotoAnalysisPhase { uploading, analyzing }

/// W20 S5 — turns one compressed photo into AI-proposed pantry items.
///
/// One call is the whole pipeline: fetch a presigned URL, PUT the photo to S3,
/// ask the server to analyze it. Every attempt uses a fresh URL and a fresh
/// upload — deliberately, because the server deletes the photo after analysis
/// whether or not the analysis succeeded, so a retry cannot reuse the old key.
abstract interface class PantryPhotoRepository {
  /// Throws an [AppError]: [PhotoUploadError] when the photo never reached
  /// S3, otherwise whatever typed error the server returned (`RATE_LIMITED`,
  /// `AI_TIMEOUT`, `NOT_FOUND`, …) — kept typed so the UI can choose between
  /// "try again", "retake" and "add manually".
  Future<PantryPhotoAnalysis> analyze(
    Uint8List jpegBytes, {
    void Function(PhotoAnalysisPhase phase)? onPhase,
  });
}

class FerryPantryPhotoRepository
    with FerryExecuteMixin
    implements PantryPhotoRepository {
  const FerryPantryPhotoRepository({
    required this.client,
    required this.uploader,
  });

  @override
  final Client client;
  final PantryPhotoUploader uploader;

  @override
  Future<PantryPhotoAnalysis> analyze(
    Uint8List jpegBytes, {
    void Function(PhotoAnalysisPhase phase)? onPhase,
  }) async {
    onPhase?.call(PhotoAnalysisPhase.uploading);
    final GGetPantryPhotoUploadUrlData urlData = await execute(
      GGetPantryPhotoUploadUrlReq(),
    );
    final GGetPantryPhotoUploadUrlData_getPantryPhotoUploadUrl upload =
        urlData.getPantryPhotoUploadUrl;
    await uploader.put(upload.url, jpegBytes);

    onPhase?.call(PhotoAnalysisPhase.analyzing);
    final GAnalyzePantryPhotoData data = await execute(
      GAnalyzePantryPhotoReq(
        (GAnalyzePantryPhotoReqBuilder b) =>
            b..vars = (GAnalyzePantryPhotoVarsBuilder()..s3Key = upload.s3Key),
      ),
    );
    return _toAnalysis(data.analyzePantryPhoto);
  }
}

PantryPhotoAnalysis _toAnalysis(
  GAnalyzePantryPhotoData_analyzePantryPhoto raw,
) => PantryPhotoAnalysis(
  items: raw.items
      .map(
        (GAnalyzePantryPhotoData_analyzePantryPhoto_items item) =>
            PantryPhotoProposal(
              name: item.name,
              quantity: item.quantity,
              unit: item.unit,
              category: item.category,
              confidence: _toConfidence(item.confidence),
              warnings: item.warnings.toList(),
            ),
      )
      .toList(),
  droppedCount: raw.droppedCount,
  truncated: raw.truncated,
);

/// `GProposalConfidence` is a built_value `EnumClass`, not a Dart `enum`, so
/// the compiler cannot check this switch for exhaustiveness. An unrecognised
/// value (a level a newer server adds) therefore falls to `low` — the
/// conservative reading, because `low` proposals start unticked in review
/// (D12): the worst case is a user ticking a good item, never silently adding
/// a bad one.
ProposalConfidence _toConfidence(GProposalConfidence confidence) =>
    switch (confidence) {
      GProposalConfidence.high => ProposalConfidence.high,
      GProposalConfidence.medium => ProposalConfidence.medium,
      _ => ProposalConfidence.low,
    };

final Provider<PantryPhotoRepository> pantryPhotoRepositoryProvider =
    Provider<PantryPhotoRepository>(
      (Ref ref) => FerryPantryPhotoRepository(
        client: ref.watch(ferryClientProvider),
        uploader: ref.watch(pantryPhotoUploaderProvider),
      ),
    );
