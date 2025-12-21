import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';
import supabase from '../config/database.js';
import { AppError } from '../middlewares/error.middleware.js';
import streamingService from './streaming.service.js';

class CertificateService {
    // Generate certificate
    async generateCertificate(studentId, courseId) {
        // Check if certificate already exists
        const { data: existing } = await supabase
            .from('certificates')
            .select('*')
            .eq('student_id', studentId)
            .eq('course_id', courseId)
            .single();

        if (existing) {
            return existing;
        }

        // Get student and course details
        const { data: student } = await supabase
            .from('users')
            .select('name, email')
            .eq('id', studentId)
            .single();

        const { data: course } = await supabase
            .from('courses')
            .select('title')
            .eq('id', courseId)
            .single();

        if (!student || !course) {
            throw new AppError('Student or course not found', 404);
        }

        // Generate certificate number
        const certificateNumber = `AS-${Date.now()}-${uuidv4().substring(0, 8).toUpperCase()}`;

        // Create PDF certificate
        const pdfBuffer = await this.createCertificatePDF(student.name, course.title, certificateNumber);

        // Upload to B2
        const uploadResult = await streamingService.uploadFile({
            buffer: pdfBuffer,
            originalname: `certificate_${certificateNumber}.pdf`,
            mimetype: 'application/pdf',
            size: pdfBuffer.length
        }, 'certificates');

        // Save certificate record
        const { data: certificate, error } = await supabase
            .from('certificates')
            .insert({
                student_id: studentId,
                course_id: courseId,
                certificate_url: uploadResult.fileUrl,
                certificate_number: certificateNumber
            })
            .select()
            .single();

        if (error) {
            throw new AppError('Failed to save certificate', 500);
        }

        return certificate;
    }

    // Create certificate PDF
    async createCertificatePDF(studentName, courseTitle, certificateNumber) {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({
                size: 'A4',
                layout: 'landscape',
                margins: { top: 50, bottom: 50, left: 50, right: 50 }
            });

            const chunks = [];
            doc.on('data', chunk => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            // Certificate design
            const pageWidth = doc.page.width;
            const pageHeight = doc.page.height;

            // Border
            doc.rect(30, 30, pageWidth - 60, pageHeight - 60)
                .lineWidth(3)
                .stroke('#1e40af');

            doc.rect(40, 40, pageWidth - 80, pageHeight - 80)
                .lineWidth(1)
                .stroke('#3b82f6');

            // Title
            doc.fontSize(40)
                .font('Helvetica-Bold')
                .fillColor('#1e40af')
                .text('CERTIFICATE OF COMPLETION', 0, 100, {
                    align: 'center',
                    width: pageWidth
                });

            // Subtitle
            doc.fontSize(16)
                .font('Helvetica')
                .fillColor('#6b7280')
                .text('This is to certify that', 0, 180, {
                    align: 'center',
                    width: pageWidth
                });

            // Student name
            doc.fontSize(32)
                .font('Helvetica-Bold')
                .fillColor('#111827')
                .text(studentName, 0, 220, {
                    align: 'center',
                    width: pageWidth
                });

            // Course completion text
            doc.fontSize(16)
                .font('Helvetica')
                .fillColor('#6b7280')
                .text('has successfully completed the course', 0, 280, {
                    align: 'center',
                    width: pageWidth
                });

            // Course title
            doc.fontSize(24)
                .font('Helvetica-Bold')
                .fillColor('#1e40af')
                .text(courseTitle, 0, 320, {
                    align: 'center',
                    width: pageWidth
                });

            // Date
            const issueDate = new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });

            doc.fontSize(14)
                .font('Helvetica')
                .fillColor('#6b7280')
                .text(`Issued on: ${issueDate}`, 0, 400, {
                    align: 'center',
                    width: pageWidth
                });

            // Certificate number
            doc.fontSize(10)
                .fillColor('#9ca3af')
                .text(`Certificate No: ${certificateNumber}`, 0, pageHeight - 80, {
                    align: 'center',
                    width: pageWidth
                });

            // AS Academy branding
            doc.fontSize(20)
                .font('Helvetica-Bold')
                .fillColor('#1e40af')
                .text('AS ACADEMY', 0, pageHeight - 120, {
                    align: 'center',
                    width: pageWidth
                });

            doc.fontSize(12)
                .font('Helvetica')
                .fillColor('#6b7280')
                .text('Online Learning Platform', 0, pageHeight - 95, {
                    align: 'center',
                    width: pageWidth
                });

            doc.end();
        });
    }

    // Get student certificates
    async getStudentCertificates(studentId) {
        const { data: certificates, error } = await supabase
            .from('certificates')
            .select(`
        *,
        courses:course_id (
          id,
          title
        )
      `)
            .eq('student_id', studentId)
            .order('issued_date', { ascending: false });

        if (error) {
            throw new AppError('Failed to fetch certificates', 500);
        }

        return certificates;
    }

    // Get certificate download URL
    async getCertificateUrl(certificateId, studentId) {
        const { data: certificate, error } = await supabase
            .from('certificates')
            .select('*')
            .eq('id', certificateId)
            .eq('student_id', studentId)
            .single();

        if (error || !certificate) {
            throw new AppError('Certificate not found', 404);
        }

        // Generate signed URL
        const signedUrl = await streamingService.getSignedUrl(certificate.certificate_url, 300); // 5 minutes

        return {
            url: signedUrl,
            certificateNumber: certificate.certificate_number
        };
    }

    // Verify certificate
    async verifyCertificate(certificateNumber) {
        const { data: certificate, error } = await supabase
            .from('certificates')
            .select(`
        *,
        users:student_id (
          name,
          email
        ),
        courses:course_id (
          title
        )
      `)
            .eq('certificate_number', certificateNumber)
            .single();

        if (error || !certificate) {
            return { valid: false, message: 'Certificate not found' };
        }

        return {
            valid: true,
            certificate: {
                studentName: certificate.users.name,
                courseTitle: certificate.courses.title,
                issuedDate: certificate.issued_date,
                certificateNumber: certificate.certificate_number
            }
        };
    }
}

export default new CertificateService();
