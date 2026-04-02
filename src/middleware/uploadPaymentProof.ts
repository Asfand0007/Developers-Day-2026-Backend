import { Request, Response, NextFunction } from 'express'
import multer from 'multer'
import { cloudinary, isCloudinaryConfigured } from '../config/cloudinary'

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024,
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true)
        } else {
            cb(new Error('Only image files are allowed.'))
        }
    },
})

export interface PaymentRequest extends Request {
    paymentProofUrl?: string
}

export const parsePaymentScreenshot = upload.single('paymentScreenshot')

export async function uploadPaymentProof(req: PaymentRequest, res: Response, next: NextFunction): Promise<void> {
    if (!isCloudinaryConfigured) {
        res.status(500).json({
            success: false,
            message: 'Payment screenshot uploads are not configured on the server. Please contact the administrator.',
        })
        return
    }

    const file = (req as Request).file

    if (!file) {
        res.status(400).json({ success: false, message: 'Payment screenshot is required.' })
        return
    }

    try {
        const uploadResult = await new Promise<{ secure_url: string }>((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
                {
                    folder: process.env.CLOUDINARY_PAYMENT_FOLDER || 'developers-day-2026/payments',
                    resource_type: 'image',
                },
                (error, result) => {
                    if (error || !result) {
                        reject(error || new Error('Cloudinary upload failed'))
                        return
                    }
                    resolve(result as { secure_url: string })
                }
            )

            stream.end(file.buffer)
        })

        req.paymentProofUrl = uploadResult.secure_url
        next()
    } catch (error) {
        console.error('[uploadPaymentProof] Failed to upload payment screenshot:', error)
        res.status(500).json({ success: false, message: 'Failed to upload payment screenshot.' })
    }
}

