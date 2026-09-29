import 'package:flutter/material.dart';

import '../../../shared/ui/colors.dart';
import '../../../shared/ui/components/components.dart';
import '../../../shared/ui/spacing.dart';
import '../../../shared/ui/typography.dart';
import '../domain/cook_vibe.dart';
import 'cook_dead_end.dart';
import 'cook_failure_copy.dart';

/// Flow 11, frame 11.1 (W21 S5): "What can I cook?" — pick a vibe (or none)
/// and ask for 3 ideas from the pantry.
///
/// [pantryTooSmall] is checked instantly, client-side, against the same
/// rule the server enforces (`domain/cookable_pantry.dart`, D6): a pantry
/// that plainly can't support a recipe skips straight to the dead end,
/// with no vibe chips and no wasted round trip.
class CookTriggerScreen extends StatefulWidget {
  const CookTriggerScreen({
    super.key,
    required this.pantryTooSmall,
    required this.onSuggest,
    required this.onAddManually,
    this.onBack,
  });

  final bool pantryTooSmall;

  /// Called with the selected vibe, or `null` for "any vibe".
  final ValueChanged<CookVibe?> onSuggest;
  final VoidCallback onAddManually;
  final VoidCallback? onBack;

  static const Key suggestButtonKey = Key('cook-trigger-suggest');
  static Key vibeChipKey(CookVibe vibe) =>
      Key('cook-trigger-vibe-${vibe.name}');

  @override
  State<CookTriggerScreen> createState() => _CookTriggerScreenState();
}

class _CookTriggerScreenState extends State<CookTriggerScreen> {
  CookVibe? _vibe = CookVibe.quick;

  void _toggle(CookVibe vibe) =>
      setState(() => _vibe = _vibe == vibe ? null : vibe);

  @override
  Widget build(BuildContext context) => Scaffold(
    backgroundColor: AppColors.paper,
    body: SafeArea(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          PTopBar(
            title: 'Cook now',
            onBack: widget.onBack ?? () => Navigator.of(context).pop(),
            backSemanticLabel: 'Back',
          ),
          Expanded(
            child: widget.pantryTooSmall
                ? CookDeadEnd(
                    copy: emptyPantryCopy,
                    onAction: (CookFailureAction action) {
                      if (action == CookFailureAction.addManually) {
                        widget.onAddManually();
                      }
                    },
                  )
                : _TriggerForm(vibe: _vibe, onToggleVibe: _toggle),
          ),
          if (!widget.pantryTooSmall)
            Padding(
              padding: const EdgeInsets.all(AppSpacing.s3),
              child: PButton(
                key: CookTriggerScreen.suggestButtonKey,
                label: '◆ Suggest 3 recipes',
                expand: true,
                onPressed: () => widget.onSuggest(_vibe),
              ),
            ),
        ],
      ),
    ),
  );
}

class _TriggerForm extends StatelessWidget {
  const _TriggerForm({required this.vibe, required this.onToggleVibe});

  final CookVibe? vibe;
  final ValueChanged<CookVibe> onToggleVibe;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(AppSpacing.s3),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Text('What can I cook?', style: AppTypography.displayM),
        const SizedBox(height: AppSpacing.s0),
        Text(
          'AI reads your pantry + preferences',
          style: AppTypography.body.copyWith(color: AppColors.inkMid),
        ),
        const SizedBox(height: AppSpacing.s3),
        Text('ANY VIBE?', style: AppTypography.label),
        const SizedBox(height: AppSpacing.s1),
        Wrap(
          spacing: AppSpacing.s1,
          runSpacing: AppSpacing.s1,
          children: <Widget>[
            for (final CookVibe v in CookVibe.values)
              PChip(
                key: CookTriggerScreen.vibeChipKey(v),
                label: v.label,
                selected: vibe == v,
                onTap: () => onToggleVibe(v),
              ),
          ],
        ),
      ],
    ),
  );
}
