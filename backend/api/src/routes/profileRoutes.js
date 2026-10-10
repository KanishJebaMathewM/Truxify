/**
 * @openapi
 * components:
 *   schemas:
 *     ProfileResponse:
 *       type: object
 *       properties:
 *         profile:
 *           type: object
 *         extra:
 *           type: object
 *           nullable: true
 *     ProfileNameResponse:
 *       type: object
 *       properties:
 *         full_name:
 *           type: string
 *     UpdateWalletRequest:
 *       type: object
 *       required:
 *         - wallet_address
 *       properties:
 *         wallet_address:
 *           type: string
 *           pattern: '^0x[a-fA-F0-9]{40}$'
 *     UpdateWalletResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         walletAddress:
 *           type: string
 *     UpdateProfileRequest:
 *       type: object
 *       properties:
 *         full_name:
 *           type: string
 *         phone:
 *           type: string
 *         email:
 *           type: string
 *         number_plate:
 *           type: string
 *         language:
 *           type: string
 *         dark_mode:
 *           type: boolean
 *         is_online:
 *           type: boolean
 *     UpdateProfileResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         profile:
 *           type: object
 *     UpdateFcmTokenRequest:
 *       type: object
 *       required:
 *         - fcmToken
 *       properties:
 *         fcmToken:
 *           type: string
 *           nullable: true
 *     DriverStatementResponse:
 *       type: object
 *       properties:
 *         summary:
 *           type: object
 *           properties:
 *             total_trips:
 *               type: integer
 *             total_base_freight:
 *               type: number
 *             total_platform_fees:
 *               type: number
 *             total_toll_estimate:
 *               type: number
 *             total_net_earnings:
 *               type: number
 *         trips:
 *           type: array
 *           items:
 *             type
