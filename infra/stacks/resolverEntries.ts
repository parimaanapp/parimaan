/**
 * The declarative resolver-wiring data `api-stack.ts`'s `createDbResolvers`/
 * `createAiAndNetResolvers` methods loop over — extracted out of
 * `api-stack.ts` itself (W12 S3) purely to keep that file under this repo's
 * `max-lines` ESLint ceiling; no behavior moved, just data. `ApiStack` is
 * still the only consumer of these three exports.
 */

/**
 * One VPC-attached, database-backed resolver Lambda and the single GraphQL
 * field it resolves. `id` doubles as the construct-id stem for all three
 * synthesized resources (`<id>Fn`, `<id>DataSource`, `<id>Resolver`), so it
 * is effectively a CloudFormation logical id — renaming one replaces the
 * Lambda rather than updating it.
 */
export interface DbResolverEntry {
  readonly id: string;
  readonly entryFile: string;
  readonly typeName: string;
  readonly fieldName: string;
  /**
   * Grants `CACHE_TABLE_NAME` + a narrow `dynamodb:UpdateItem` on the shared
   * cache table. True ONLY for the rate-limited mutations — `joinHousehold`
   * (guessable invite-code keyspace) and `rotateInviteCode` (destructive for
   * co-members). Every other resolver must have no DynamoDB access at all.
   */
  readonly needsCacheTable?: boolean;
}

/**
 * The full set of database-backed resolvers, declared once and wired by a
 * single loop in `api-stack.ts` — the per-Lambda `createDbResolverFunction`
 * + `wireResolver` + grant sequence is identical for every entry, so keeping
 * it as data rather than repeated statements is what makes adding a
 * resolver a one-line change (and keeps the wiring method under the
 * 50-line `max-lines-per-function` ceiling).
 */
export const DB_RESOLVERS: readonly DbResolverEntry[] = [
  { id: 'Me', entryFile: 'me.ts', typeName: 'Query', fieldName: 'me' },
  {
    id: 'CreateHousehold',
    entryFile: 'createHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'createHousehold',
  },
  {
    id: 'UserHouseholds',
    entryFile: 'userHouseholds.ts',
    typeName: 'User',
    fieldName: 'households',
  },
  {
    id: 'JoinHousehold',
    entryFile: 'joinHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'joinHousehold',
    needsCacheTable: true,
  },
  {
    id: 'UpdateHouseholdSettings',
    entryFile: 'updateHouseholdSettings.ts',
    typeName: 'Mutation',
    fieldName: 'updateHouseholdSettings',
  },
  {
    id: 'RotateInviteCode',
    entryFile: 'rotateInviteCode.ts',
    typeName: 'Mutation',
    fieldName: 'rotateInviteCode',
    needsCacheTable: true,
  },
  {
    id: 'LeaveHousehold',
    entryFile: 'leaveHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'leaveHousehold',
  },
  {
    id: 'DeleteHousehold',
    entryFile: 'deleteHousehold.ts',
    typeName: 'Mutation',
    fieldName: 'deleteHousehold',
  },
  {
    id: 'Household',
    entryFile: 'household.ts',
    typeName: 'Query',
    fieldName: 'household',
  },
  {
    id: 'Pantry',
    entryFile: 'pantry.ts',
    typeName: 'Query',
    fieldName: 'pantry',
  },
  {
    id: 'AddPantryItem',
    entryFile: 'addPantryItem.ts',
    typeName: 'Mutation',
    fieldName: 'addPantryItem',
  },
  {
    id: 'UpdatePantryItem',
    entryFile: 'updatePantryItem.ts',
    typeName: 'Mutation',
    fieldName: 'updatePantryItem',
  },
  {
    id: 'DeletePantryItem',
    entryFile: 'deletePantryItem.ts',
    typeName: 'Mutation',
    fieldName: 'deletePantryItem',
  },
  {
    id: 'BulkAddPantryItems',
    entryFile: 'bulkAddPantryItems.ts',
    typeName: 'Mutation',
    fieldName: 'bulkAddPantryItems',
  },
  {
    id: 'OnPantryChanged',
    entryFile: 'onPantryChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onPantryChanged',
  },
  {
    id: 'Recipes',
    entryFile: 'recipes.ts',
    typeName: 'Query',
    fieldName: 'recipes',
  },
  {
    id: 'Recipe',
    entryFile: 'recipe.ts',
    typeName: 'Query',
    fieldName: 'recipe',
  },
  {
    id: 'RecipeIngredients',
    entryFile: 'recipeIngredients.ts',
    typeName: 'Recipe',
    fieldName: 'ingredients',
  },
  {
    id: 'CreateRecipe',
    entryFile: 'createRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'createRecipe',
  },
  {
    id: 'UpdateRecipe',
    entryFile: 'updateRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'updateRecipe',
  },
  {
    id: 'DeleteRecipe',
    entryFile: 'deleteRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'deleteRecipe',
  },
  {
    id: 'FavoriteRecipe',
    entryFile: 'favoriteRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'favoriteRecipe',
  },
  {
    id: 'SetInRotation',
    entryFile: 'setInRotation.ts',
    typeName: 'Mutation',
    fieldName: 'setInRotation',
  },
  {
    id: 'OnRecipeChanged',
    entryFile: 'onRecipeChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onRecipeChanged',
  },
  {
    id: 'OnHouseholdChanged',
    entryFile: 'onHouseholdChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onHouseholdChanged',
  },
  {
    id: 'NotificationPreferences',
    entryFile: 'notificationPreferences.ts',
    typeName: 'Query',
    fieldName: 'notificationPreferences',
  },
  {
    id: 'UpdateNotificationPreferences',
    entryFile: 'updateNotificationPreferences.ts',
    typeName: 'Mutation',
    fieldName: 'updateNotificationPreferences',
  },
  {
    id: 'Menu',
    entryFile: 'menu.ts',
    typeName: 'Query',
    fieldName: 'menu',
  },
  {
    id: 'CreateMenu',
    entryFile: 'createMenu.ts',
    typeName: 'Mutation',
    fieldName: 'createMenu',
  },
  {
    id: 'AddMenuItem',
    entryFile: 'addMenuItem.ts',
    typeName: 'Mutation',
    fieldName: 'addMenuItem',
  },
  {
    id: 'RemoveMenuItem',
    entryFile: 'removeMenuItem.ts',
    typeName: 'Mutation',
    fieldName: 'removeMenuItem',
  },
  {
    id: 'AutoFillPreview',
    entryFile: 'autoFillPreview.ts',
    typeName: 'Query',
    fieldName: 'autoFillPreview',
  },
  {
    id: 'AutoFillWeek',
    entryFile: 'autoFillWeek.ts',
    typeName: 'Mutation',
    fieldName: 'autoFillWeek',
  },
  {
    id: 'GenerateShoppingList',
    entryFile: 'generateShoppingList.ts',
    typeName: 'Mutation',
    fieldName: 'generateShoppingList',
  },
  {
    id: 'RegenerateShoppingList',
    entryFile: 'regenerateShoppingList.ts',
    typeName: 'Mutation',
    fieldName: 'regenerateShoppingList',
  },
  {
    id: 'HaveIt',
    entryFile: 'haveIt.ts',
    typeName: 'Mutation',
    fieldName: 'haveIt',
  },
  {
    id: 'MarkMade',
    entryFile: 'markMade.ts',
    typeName: 'Mutation',
    fieldName: 'markMade',
  },
  {
    id: 'OnMenuChanged',
    entryFile: 'onMenuChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onMenuChanged',
  },
  {
    id: 'OnMembershipRevoked',
    entryFile: 'onMembershipRevoked.ts',
    typeName: 'Subscription',
    fieldName: 'onMembershipRevoked',
  },
  {
    id: 'MarkPurchased',
    entryFile: 'markPurchased.ts',
    typeName: 'Mutation',
    fieldName: 'markPurchased',
  },
  {
    id: 'OnShoppingListChanged',
    entryFile: 'onShoppingListChanged.ts',
    typeName: 'Subscription',
    fieldName: 'onShoppingListChanged',
  },
];

/**
 * One non-VPC resolver Lambda and the single GraphQL field it resolves —
 * the `DbResolverEntry`/`DB_RESOLVERS` shape, adapted for the second Lambda
 * category this stack builds (`E2E_MVP_PLAN.md` §13.2.1, D3).
 */
export interface NonVpcResolverEntry {
  readonly id: string;
  readonly entryFile: string;
  readonly typeName: string;
  readonly fieldName: string;
  /** Grants `GEMINI_API_KEY_SECRET_ARN` + a narrow `secretsmanager:GetSecretValue` scoped to that one secret's ARN. True only for resolvers that actually call Gemini — `importRecipeFromUrl` (S5) never sets this. */
  readonly needsGeminiSecret?: boolean;
  /** Grants `CACHE_TABLE_NAME` + a narrow `dynamodb:UpdateItem` on the shared cache table — same flag, same narrow grant shape as `DbResolverEntry.needsCacheTable` above, reused here rather than re-invented for this category. True for `parseFreeformRecipe` (S3, `'freeformParse'` rate limit) and, later, `importRecipeFromUrl` (S5, `'urlImport'`). */
  readonly needsCacheTable?: boolean;
}

/**
 * The AI-calling non-VPC resolvers. `parseFreeformRecipe` (S3) is the
 * first real entry — `AI_RESOLVERS` stayed empty through S2 only because
 * AppSync's `createResolver` requires the field to already exist in the
 * deployed SDL, which S3 is what adds.
 */
export const AI_RESOLVERS: readonly NonVpcResolverEntry[] = [
  {
    id: 'ParseFreeformRecipe',
    entryFile: 'parseFreeformRecipe.ts',
    typeName: 'Mutation',
    fieldName: 'parseFreeformRecipe',
    needsGeminiSecret: true,
    needsCacheTable: true,
  },
];

/**
 * The non-AI, non-VPC resolvers. `importRecipeFromUrl` (S5) never calls
 * Gemini — no `needsGeminiSecret` — but shares the identical non-VPC/
 * no-Aurora-route rationale as `AI_RESOLVERS` (§13.2.1 D3) and needs the
 * cache table for its own `'urlImport'` rate limit (§13.2.9 D8).
 */
export const NET_RESOLVERS: readonly NonVpcResolverEntry[] = [
  {
    id: 'ImportRecipeFromUrl',
    entryFile: 'importRecipeFromUrl.ts',
    typeName: 'Mutation',
    fieldName: 'importRecipeFromUrl',
    needsCacheTable: true,
  },
];
