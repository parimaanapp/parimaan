import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/app.dart';
import 'app/config/app_config.dart';
import 'app/config/dev_config.dart';
import 'features/auth/data/amplify_auth_repository.dart';
import 'features/auth/data/auth_repository.dart';

/// Composition root. The only place that decides which [AppConfig] and which
/// [AuthRepository] implementation the app runs with.
///
/// Amplify is not configured here — [AmplifyAuthRepository] configures itself
/// lazily on first use, so a bad config surfaces as an in-app error on the
/// sign-in screen rather than a crash before the first frame.
void main() {
  WidgetsFlutterBinding.ensureInitialized();

  const AppConfig config = devConfig;

  runApp(
    ParimaanApp(
      overrides: <Override>[
        authRepositoryProvider.overrideWithValue(
          AmplifyAuthRepository(config: config),
        ),
      ],
    ),
  );
}
