const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { Storage } = require('@google-cloud/storage');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const axios = require('axios');
const cors = require('cors')({ origin: true });
const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const sgMail = require('@sendgrid/mail');

admin.initializeApp();
const storage = new Storage();
const bucket = storage.bucket('job-application-ba250.appspot.com');

// Initialize SendGrid
sgMail.setApiKey(functions.config().sendgrid.key);

// Initialize Google Sheets
const doc = new GoogleSpreadsheet(functions.config().google.sheet_id);
const serviceAccount = require('./service-account-key.json');

// Enhanced CV parsing function with better section detection
async function processCV(fileBuffer, fileType) {
  let text = '';
  
  // Extract text based on file type
  if (fileType === 'application/pdf') {
    const data = await pdfParse(fileBuffer);
    text = data.text;
  } else if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer: fileBuffer });
    text = result.value;
  }

  // Initialize sections with more detailed structure
  const sections = {
    personal_info: {
      name: '',
      email: '',
      phone: '',
      address: '',
      linkedin: '',
      website: ''
    },
    education: [],
    qualifications: [],
    projects: []
  };

  const lines = text.split('\n').map(line => line.trim()).filter(line => line);
  let currentSection = '';
  let tempSection = [];

  // Regular expressions for better section detection
  const sectionPatterns = {
    education: /^(?:education|academic|educational background|academic history)/i,
    qualifications: /^(?:qualifications|skills|certifications|technical skills|expertise)/i,
    projects: /^(?:projects|work experience|professional experience|portfolio)/i,
    personal: /^(?:personal information|personal details|contact|profile)/i
  };

  // Regular expressions for personal information
  const personalInfoPatterns = {
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/,
    phone: /(?:\+?\d{1,3}[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}/,
    linkedin: /linkedin\.com\/in\/[A-Za-z0-9-]+/i,
    website: /(?:http[s]?:\/\/)?(?:www\.)?[A-Za-z0-9-]+\.[A-Za-z]{2,}(?:\/[^\s]*)?/
  };

  // Process each line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Check for section headers
    let sectionFound = false;
    for (const [section, pattern] of Object.entries(sectionPatterns)) {
      if (pattern.test(lowerLine)) {
        if (currentSection && tempSection.length > 0) {
          processSectionContent(sections, currentSection, tempSection);
        }
        currentSection = section;
        tempSection = [];
        sectionFound = true;
        break;
      }
    }

    if (!sectionFound) {
      // Extract personal information from any line
      if (personalInfoPatterns.email.test(line)) {
        sections.personal_info.email = line.match(personalInfoPatterns.email)[0];
      }
      if (personalInfoPatterns.phone.test(line)) {
        sections.personal_info.phone = line.match(personalInfoPatterns.phone)[0];
      }
      if (personalInfoPatterns.linkedin.test(line)) {
        sections.personal_info.linkedin = line.match(personalInfoPatterns.linkedin)[0];
      }
      if (personalInfoPatterns.website.test(line)) {
        const website = line.match(personalInfoPatterns.website)[0];
        if (!website.includes('linkedin')) {
          sections.personal_info.website = website;
        }
      }

      // If no name is set and line looks like a name (2-3 words, no special chars)
      if (!sections.personal_info.name && /^[A-Za-z\s]{2,50}$/.test(line) && line.split(' ').length <= 3) {
        sections.personal_info.name = line;
      }

      // Add line to current section
      if (currentSection) {
        tempSection.push(line);
      }
    }
  }

  // Process the last section
  if (currentSection && tempSection.length > 0) {
    processSectionContent(sections, currentSection, tempSection);
  }

  return sections;
}

// Helper function to process section content
function processSectionContent(sections, section, content) {
  switch (section) {
    case 'education':
      // Group education entries (typically 2-3 lines form one entry)
      let eduEntry = [];
      for (const line of content) {
        eduEntry.push(line);
        if (eduEntry.length === 3 || /\d{4}/.test(line)) { // Year usually indicates end of entry
          sections.education.push(eduEntry.join(' - '));
          eduEntry = [];
        }
      }
      if (eduEntry.length > 0) {
        sections.education.push(eduEntry.join(' - '));
      }
      break;

    case 'qualifications':
      // Split qualifications into individual skills/certifications
      sections.qualifications = content.map(line => {
        // Remove bullet points and common separators
        return line.replace(/^[•\-\*\★\⚫]\s*/, '').trim();
      }).filter(qual => qual.length > 2); // Filter out too short entries
      break;

    case 'projects':
      let projectEntry = {
        name: '',
        description: '',
        technologies: []
      };
      
      for (const line of content) {
        if (/^[A-Z]/.test(line) && line.length < 100) { // Likely a project name
          if (projectEntry.name) {
            sections.projects.push({ ...projectEntry });
            projectEntry = { name: '', description: '', technologies: [] };
          }
          projectEntry.name = line;
        } else if (/technologies|tools|stack|built with/i.test(line)) {
          projectEntry.technologies = line.split(/[,|;]/).map(tech => tech.trim());
        } else {
          projectEntry.description += (projectEntry.description ? ' ' : '') + line;
        }
      }
      
      if (projectEntry.name) {
        sections.projects.push(projectEntry);
      }
      break;

    case 'personal':
      // Already handled by regex patterns
      break;
  }
}

// Helper function to determine convenient time in user's timezone
function getConvenientScheduleTime(timezone = 'UTC') {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const userTime = new Date(tomorrow.toLocaleString('en-US', { timeZone: timezone }));
  
  // Set to 10:00 AM in user's timezone
  userTime.setHours(10, 0, 0, 0);
  
  // Convert back to UTC for storage
  const utcTime = new Date(userTime.toLocaleString('en-US', { timeZone: 'UTC' }));
  return utcTime;
}

// Upload CV to Firebase Storage
exports.uploadCV = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      if (!req.files || !req.files.cv) {
        throw new Error('No CV file uploaded');
      }

      const file = req.files.cv;
      const fileName = `${Date.now()}-${file.name}`;
      const filePath = `cvs/${fileName}`;

      // Upload to Firebase Storage
      const fileUpload = bucket.file(filePath);
      await fileUpload.save(file.data, {
        metadata: {
          contentType: file.mimetype,
        },
      });

      // Make the file publicly accessible
      await fileUpload.makePublic();
      const publicUrl = `https://storage.googleapis.com/${bucket.name}/${filePath}`;

      // Process the CV
      const cvData = await processCV(file.data, file.mimetype);

      // Add to Google Sheets with better organization
      await doc.useServiceAccountAuth(serviceAccount);
      await doc.loadInfo();
      
      // Get or create sheets for different sections
      let mainSheet = doc.sheetsByTitle['Applications'];
      if (!mainSheet) {
        mainSheet = await doc.addSheet({
          title: 'Applications',
          headerValues: [
            'Timestamp',
            'Name',
            'Email',
            'Phone',
            'LinkedIn',
            'Website',
            'CV Link',
            'Status',
            'Processing Status'
          ]
        });
      }

      let educationSheet = doc.sheetsByTitle['Education'];
      if (!educationSheet) {
        educationSheet = await doc.addSheet({
          title: 'Education',
          headerValues: [
            'Applicant Email',
            'Institution',
            'Degree',
            'Year'
          ]
        });
      }

      let qualificationsSheet = doc.sheetsByTitle['Qualifications'];
      if (!qualificationsSheet) {
        qualificationsSheet = await doc.addSheet({
          title: 'Qualifications',
          headerValues: [
            'Applicant Email',
            'Qualification',
            'Category'
          ]
        });
      }

      let projectsSheet = doc.sheetsByTitle['Projects'];
      if (!projectsSheet) {
        projectsSheet = await doc.addSheet({
          title: 'Projects',
          headerValues: [
            'Applicant Email',
            'Project Name',
            'Description',
            'Technologies'
          ]
        });
      }

      // Add main application data
      await mainSheet.addRow({
        Timestamp: new Date().toISOString(),
        Name: cvData.personal_info.name || req.body.name || 'Unknown',
        Email: cvData.personal_info.email || req.body.email || 'Unknown',
        Phone: cvData.personal_info.phone || '',
        LinkedIn: cvData.personal_info.linkedin || '',
        Website: cvData.personal_info.website || '',
        'CV Link': publicUrl,
        Status: 'New',
        'Processing Status': 'Completed'
      });

      // Add education entries
      const applicantEmail = cvData.personal_info.email || req.body.email || 'Unknown';
      for (const education of cvData.education) {
        const [institution, degree, year] = education.split(' - ');
        await educationSheet.addRow({
          'Applicant Email': applicantEmail,
          Institution: institution || '',
          Degree: degree || '',
          Year: year || ''
        });
      }

      // Add qualifications
      for (const qualification of cvData.qualifications) {
        await qualificationsSheet.addRow({
          'Applicant Email': applicantEmail,
          Qualification: qualification,
          Category: categorizeQualification(qualification)
        });
      }

      // Add projects
      for (const project of cvData.projects) {
        await projectsSheet.addRow({
          'Applicant Email': applicantEmail,
          'Project Name': project.name,
          Description: project.description,
          Technologies: project.technologies.join(', ')
        });
      }

      // Send webhook with enhanced error handling and retries
      const MAX_RETRIES = 3;
      const RETRY_DELAY = 1000; // 1 second

      async function sendWebhookWithRetry(payload, retryCount = 0) {
        try {
          const response = await axios.post(
            'https://rnd-assignment.automations-3d6.workers.dev/',
            payload,
            {
              headers: {
                'Content-Type': 'application/json',
                'X-Candidate-Email': 'your.email@metana.com', // Replace with your Metana application email
              },
              timeout: 5000 // 5 seconds timeout
            }
          );

          if (response.status === 200) {
            console.log('Webhook sent successfully:', response.data);
            return true;
          }
        } catch (error) {
          console.error(`Webhook attempt ${retryCount + 1} failed:`, error.message);
          
          if (retryCount < MAX_RETRIES - 1) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * (retryCount + 1)));
            return sendWebhookWithRetry(payload, retryCount + 1);
          }
          
          throw new Error(`Failed to send webhook after ${MAX_RETRIES} attempts`);
        }
      }

      // Prepare webhook payload according to the specified format
      const webhookPayload = {
        cv_data: {
          personal_info: {
            name: cvData.personal_info.name || req.body.name || 'Unknown',
            email: cvData.personal_info.email || req.body.email || 'Unknown',
            phone: cvData.personal_info.phone || '',
            linkedin: cvData.personal_info.linkedin || '',
            website: cvData.personal_info.website || ''
          },
          education: cvData.education.map(edu => {
            const [institution, degree, year] = edu.split(' - ');
            return {
              institution: institution || '',
              degree: degree || '',
              year: year || ''
            };
          }),
          qualifications: cvData.qualifications.map(qual => ({
            skill: qual,
            category: categorizeQualification(qual)
          })),
          projects: cvData.projects.map(project => ({
            name: project.name,
            description: project.description,
            technologies: project.technologies
          })),
          cv_public_link: publicUrl
        },
        metadata: {
          applicant_name: cvData.personal_info.name || req.body.name || 'Unknown',
          email: cvData.personal_info.email || req.body.email || 'Unknown',
          status: process.env.NODE_ENV === 'production' ? 'prod' : 'testing',
          cv_processed: true,
          processed_timestamp: new Date().toISOString()
        }
      };

      try {
        await sendWebhookWithRetry(webhookPayload);
        console.log('Webhook sent successfully with payload:', JSON.stringify(webhookPayload, null, 2));
      } catch (webhookError) {
        console.error('Final webhook error:', webhookError);
        // Store failed webhook in Firestore for retry
        await admin.firestore().collection('failed_webhooks').add({
          payload: webhookPayload,
          error: webhookError.message,
          timestamp: new Date().toISOString(),
          attempts: MAX_RETRIES
        });
      }

      // Enhanced email scheduling with timezone consideration
      const emailPayload = {
        to: req.body.email,
        from: 'your-verified-sender@example.com',
        subject: 'Your CV is Under Review',
        text: `Dear ${req.body.name},

Thank you for submitting your CV to our job application system. We have received it and it is currently under review by our team.

Your application details:
- Submission Time: ${new Date().toLocaleString()}
- Application Status: Under Review

We appreciate your interest in joining our team. If your qualifications match our requirements, we will contact you for the next steps.

Best regards,
The Hiring Team`,
        html: `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Thank you for your application</h2>
          <p>Dear ${req.body.name},</p>
          <p>Thank you for submitting your CV to our job application system. We have received it and it is currently under review by our team.</p>
          <div style="margin: 20px 0; padding: 15px; background-color: #f5f5f5; border-radius: 5px;">
            <h3 style="margin-top: 0;">Your application details:</h3>
            <ul>
              <li>Submission Time: ${new Date().toLocaleString()}</li>
              <li>Application Status: Under Review</li>
            </ul>
          </div>
          <p>We appreciate your interest in joining our team. If your qualifications match our requirements, we will contact you for the next steps.</p>
          <p>Best regards,<br>The Hiring Team</p>
        </div>`
      };

      // Get timezone from request or try to detect it
      const timezone = req.body.timezone || 'UTC';
      const scheduledTime = getConvenientScheduleTime(timezone);

      // Store email in Firestore with timezone-aware scheduling
      await admin.firestore().collection('scheduled_emails').add({
        ...emailPayload,
        scheduled_for: scheduledTime,
        timezone: timezone,
        attempts: 0,
        maxAttempts: 3
      });

      res.status(200).json({
        success: true,
        message: 'CV processed successfully',
        cv_link: publicUrl
      });
    } catch (error) {
      console.error('Error processing CV:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
});

// Enhanced email sending function with retry logic and timezone consideration
exports.sendScheduledEmails = functions.pubsub.schedule('every 1 hours').onRun(async (context) => {
  const now = new Date();
  
  try {
    const emailsSnapshot = await admin.firestore()
      .collection('scheduled_emails')
      .where('scheduled_for', '<=', now)
      .where('attempts', '<', 3)
      .get();

    const sendPromises = emailsSnapshot.docs.map(async (doc) => {
      const emailData = doc.data();
      
      try {
        await sgMail.send({
          ...emailData,
          trackingSettings: {
            clickTracking: { enable: true },
            openTracking: { enable: true }
          }
        });

        // Delete successfully sent email
        await doc.ref.delete();
        
        // Log success
        await admin.firestore().collection('email_logs').add({
          emailId: doc.id,
          status: 'sent',
          sentAt: now,
          to: emailData.to
        });
      } catch (error) {
        // Update attempt count and log error
        await doc.ref.update({
          attempts: admin.firestore.FieldValue.increment(1),
          lastError: error.message,
          lastAttempt: now
        });

        await admin.firestore().collection('email_logs').add({
          emailId: doc.id,
          status: 'failed',
          error: error.message,
          attemptAt: now,
          to: emailData.to
        });
      }
    });

    await Promise.all(sendPromises);
    
    // Clean up old failed emails
    const oldFailedEmails = await admin.firestore()
      .collection('scheduled_emails')
      .where('attempts', '>=', 3)
      .get();

    const cleanupPromises = oldFailedEmails.docs.map(doc => 
      admin.firestore().collection('email_logs').add({
        emailId: doc.id,
        status: 'abandoned',
        reason: 'Max attempts reached',
        timestamp: now,
        to: doc.data().to
      }).then(() => doc.ref.delete())
    );

    await Promise.all(cleanupPromises);
  } catch (error) {
    console.error('Error in email scheduling function:', error);
  }
});

// Add this helper function for qualification categorization
function categorizeQualification(qualification) {
  const categories = {
    'Programming Languages': /(java|python|javascript|typescript|c\+\+|ruby|php|swift|kotlin|go|rust)/i,
    'Web Technologies': /(html|css|react|angular|vue|node|express|django|flask|spring)/i,
    'Databases': /(sql|mysql|postgresql|mongodb|oracle|redis|elasticsearch)/i,
    'Cloud & DevOps': /(aws|azure|gcp|docker|kubernetes|jenkins|ci\/cd|devops)/i,
    'Tools & Frameworks': /(git|jira|agile|scrum|maven|gradle|webpack|babel)/i,
    'Soft Skills': /(communication|leadership|teamwork|problem.solving|analytical)/i
  };

  for (const [category, pattern] of Object.entries(categories)) {
    if (pattern.test(qualification)) {
      return category;
    }
  }
  
  return 'Other';
}
