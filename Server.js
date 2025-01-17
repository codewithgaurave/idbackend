const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const xlsx = require('xlsx');
const crypto = require('crypto');
const { Buffer } = require('buffer');

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(cors());

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected successfully'))
  .catch((error) => {
    console.error('MongoDB connection error:', error.message);
    process.exit(1);
  });

// Models
const schoolSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  schoolLogo: { type: String, required: true },
  subscriptionPlan: { type: String, required: true },
  licenseCode: { type: String, required: true },
  studentsAllowed: { type: Number, required: true },
  subscriptionExpiry: { type: Date, required: true },
});

const School = mongoose.model('School', schoolSchema);

const studentSchema = new mongoose.Schema({
  schoolId: { type: mongoose.Schema.Types.ObjectId, ref: 'School', required: true },
  name: { type: String, required: true },
  grade: { type: String, required: true },
  dob: { type: String, required: true },
  bloodGroup: { type: String, required: true },
  guardianContact: { type: String, required: true },
  address: { type: String, required: true },
  studentImage: { type: String, required: true }
});

const Student = mongoose.model('Student', studentSchema);

// Storage Configurations
const schoolLogoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads/schoolLogos';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const studentImageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads/studentImages';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const importedFilesStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './uploads/imports';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = crypto.randomBytes(8).toString('hex');
    cb(null, `${Date.now()}-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const uploadSchoolLogo = multer({ storage: schoolLogoStorage });
const uploadStudentImage = multer({ storage: studentImageStorage });
const uploadExcelFile = multer({
  storage: importedFilesStorage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      cb(null, true);
    } else {
      cb(new Error('Please upload an Excel file (.xlsx)'));
    }
  },
});

// Helper Functions
const generateLicenseCode = () => {
  return 'LIC-' + Math.random().toString(36).substr(2, 9);
};

const saveBase64Image = (base64String, schoolId) => {
  return new Promise((resolve, reject) => {
    try {
      const base64Data = base64String.replace(/^data:image\/\w+;base64,/, '');
      const uniqueSuffix = crypto.randomBytes(8).toString('hex');
      const filename = `${Date.now()}-${uniqueSuffix}.png`;
      const filepath = path.join('uploads', 'studentImages', filename);
      
      const dir = path.join('uploads', 'studentImages');
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(filepath, base64Data, 'base64');
      resolve(filepath);
    } catch (error) {
      reject(error);
    }
  });
};

// Authentication Middleware
const authMiddleware = (req, res, next) => {
  const token = req.header('Authorization');
  if (!token) return res.status(401).json({ message: 'Access denied. No token provided.' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.school = decoded;
    next();
  } catch (error) {
    res.status(400).json({ message: 'Invalid token.' });
  }
};

// Routes

// School Signup
app.post('/api/auth/signup', uploadSchoolLogo.single('schoolLogo'), async (req, res) => {
  const { name, email, password, phone, address, subscriptionPlan } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    
    let studentsAllowed;
    let subscriptionExpiry;

    switch(subscriptionPlan) {
      case 'Beginner':
        studentsAllowed = 100;
        subscriptionExpiry = new Date();
        subscriptionExpiry.setFullYear(subscriptionExpiry.getFullYear() + 1);
        break;
      case 'Intermediate':
        studentsAllowed = 500;
        subscriptionExpiry = new Date();
        subscriptionExpiry.setFullYear(subscriptionExpiry.getFullYear() + 1);
        break;
      case 'Standard':
        studentsAllowed = 1000;
        subscriptionExpiry = new Date();
        subscriptionExpiry.setFullYear(subscriptionExpiry.getFullYear() + 1);
        break;
      default:
        return res.status(400).json({ message: 'Invalid subscription plan selected.' });
    }

    const licenseCode = generateLicenseCode();

    const school = new School({
      name,
      email,
      password: hashedPassword,
      phone,
      address,
      schoolLogo: req.file.path,
      subscriptionPlan,
      licenseCode,
      studentsAllowed,
      subscriptionExpiry,
    });

    await school.save();
    res.status(201).json({ message: 'School registered successfully!', licenseCode });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// School Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const school = await School.findOne({ email });
    if (!school) return res.status(404).json({ message: 'School not found' });

    const isPasswordValid = await bcrypt.compare(password, school.password);
    if (!isPasswordValid) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign({ id: school._id }, process.env.JWT_SECRET, { expiresIn: '1h' });

    res.json({
      token,
      school: {
        name: school.name,
        email: school.email,
        phone: school.phone,
        address: school.address,
        logoUrl: school.schoolLogo
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Add Student
app.post('/api/students', authMiddleware, uploadStudentImage.single('studentImage'), async (req, res) => {
  const { name, grade, dob, bloodGroup, guardianContact, address } = req.body;
  try {
    const school = await School.findById(req.school.id);

    if (!school.subscriptionPlan || school.subscriptionPlan === '') {
      return res.status(403).json({ message: 'No subscription plan found. Please select a plan to add students.' });
    }

    if (new Date() > school.subscriptionExpiry) {
      return res.status(403).json({ message: 'Subscription expired. Please renew your plan to add more students.' });
    }

    const studentCount = await Student.countDocuments({ schoolId: school._id });

    if (studentCount >= school.studentsAllowed) {
      return res.status(403).json({ message: `Student limit reached for the ${school.subscriptionPlan} plan.` });
    }

    const student = new Student({
      schoolId: school._id,
      name,
      grade,
      dob,
      bloodGroup,
      guardianContact,
      address,
      studentImage: req.file.path,
    });

    await student.save();
    res.status(201).json({ message: 'Student added successfully!' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get School Data with Students
app.get('/api/students', authMiddleware, async (req, res) => {
  try {
    const school = await School.findById(req.school.id);
    if (!school) {
      return res.status(404).json({ message: 'School not found' });
    }

    const students = await Student.find({ schoolId: school.id });

    res.json({
      school: {
        name: school.name,
        email: school.email,
        phone: school.phone,
        address: school.address,
        logoUrl: school.schoolLogo,
        subscriptionPlan: school.subscriptionPlan,
        studentsAllowed: school.studentsAllowed,
        subscriptionExpiry: school.subscriptionExpiry,
      },
      students,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Update Student
app.put('/api/students/:id', authMiddleware, uploadStudentImage.single('studentImage'), async (req, res) => {
  const { id } = req.params;
  const { name, grade, dob, bloodGroup, guardianContact, address } = req.body;

  try {
    const student = await Student.findOne({ _id: id, schoolId: req.school.id });

    if (!student) {
      return res.status(404).json({ message: 'Student not found or you do not have permission to update this student' });
    }

    student.name = name || student.name;
    student.grade = grade || student.grade;
    student.dob = dob || student.dob;
    student.bloodGroup = bloodGroup || student.bloodGroup;
    student.guardianContact = guardianContact || student.guardianContact;
    student.address = address || student.address;

    if (req.file) {
      if (fs.existsSync(student.studentImage)) {
        fs.unlinkSync(student.studentImage);
      }
      student.studentImage = req.file.path;
    }
    await student.save();
    res.json({ message: 'Student updated successfully!', student });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete Student
app.delete('/api/students/:id', authMiddleware, async (req, res) => {
  const { id } = req.params;

  try {
    const student = await Student.findOne({ _id: id, schoolId: req.school.id });

    if (!student) {
      return res.status(404).json({ message: 'Student not found or you do not have permission to delete this student' });
    }

    if (fs.existsSync(student.studentImage)) {
      fs.unlinkSync(student.studentImage);
    }

    await Student.deleteOne({ _id: id });
    res.json({ message: 'Student deleted successfully!' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Import Students from Excel
app.post('/api/students/import', authMiddleware, uploadExcelFile.single('excelFile'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload an Excel file' });
    }

    const school = await School.findById(req.school.id);

    // Validate subscription
    if (!school.subscriptionPlan || school.subscriptionPlan === '') {
      return res.status(403).json({ message: 'No subscription plan found. Please select a plan to import students.' });
    }

    if (new Date() > school.subscriptionExpiry) {
      return res.status(403).json({ message: 'Subscription expired. Please renew your plan to import students.' });
    }

    // Read Excel file
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const studentsData = xlsx.utils.sheet_to_json(worksheet);

    // Validate data
    if (!Array.isArray(studentsData) || studentsData.length === 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ message: 'Invalid data format or empty file' });
    }

    // Check student limit
    const currentStudentCount = await Student.countDocuments({ schoolId: school._id });
    if (currentStudentCount + studentsData.length > school.studentsAllowed) {
      fs.unlinkSync(req.file.path);
      return res.status(403).json({ 
        message: `Importing ${studentsData.length} students would exceed your plan limit of ${school.studentsAllowed} students. Current count: ${currentStudentCount}`
      });
    }

    // Process students
    const studentDocs = await Promise.all(studentsData.map(async (student) => {
      let imagePath = 'uploads/studentImages/default.png'; // Default image path

      if (student.studentImage && student.studentImage.trim() !== '') {
        try {
          imagePath = await saveBase64Image(student.studentImage, school._id);
        } catch (error) {
          console.error(`Error saving image for student ${student.name}:`, error);
        }
      }

      return {
        schoolId: school._id,
        name: student.name || '',
        grade: student.grade || '',
        dob: student.dob || '',
        bloodGroup: student.bloodGroup || '',
        guardianContact: student.guardianContact || '',
        address: student.address || '',
        studentImage: imagePath
      };
    }));

    // Validate required fields
    const invalidStudents = studentDocs.filter(student => 
      !student.name || !student.grade || !student.dob || 
      !student.bloodGroup || !student.guardianContact || !student.address
    );

    if (invalidStudents.length > 0) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        message: 'Some students have missing required fields',
        invalidStudents: invalidStudents.map(s => s.name || 'Unnamed student')
      });
    }

    // Insert students
    await Student.insertMany(studentDocs);

    // Clean up
    fs.unlinkSync(req.file.path);

    res.status(201).json({ 
      message: 'Students imported successfully!',
      imported: studentDocs.length,
      totalStudents: currentStudentCount + studentDocs.length,
      remainingSlots: school.studentsAllowed - (currentStudentCount + studentDocs.length)
    });

  } catch (error) {
    // Clean up the uploaded file in case of error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Error importing students:', error);
    res.status(500).json({ 
      message: 'Failed to import student data', 
      error: error.message 
    });
  }
});

// Export Students to Excel
app.get('/api/students/export', authMiddleware, async (req, res) => {
  try {
    const students = await Student.find({ schoolId: req.school.id });
    
    // Transform the data for export
    const exportData = students.map(student => ({
      name: student.name,
      grade: student.grade,
      dob: student.dob,
      bloodGroup: student.bloodGroup,
      guardianContact: student.guardianContact,
      address: student.address
    }));

    // Create workbook and worksheet
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(exportData);

    // Add worksheet to workbook
    xlsx.utils.book_append_sheet(wb, ws, 'Students');

    // Generate Excel file
    const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=students.xlsx');

    // Send the file
    res.send(Buffer.from(excelBuffer));

  } catch (error) {
    console.error('Error exporting students:', error);
    res.status(500).json({ 
      message: 'Failed to export student data', 
      error: error.message 
    });
  }
});

// Get Import Template
app.get('/api/students/import-template', authMiddleware, (req, res) => {
  try {
    // Create template structure
    const templateData = [{
      name: 'Example Student',
      grade: '10',
      dob: '2000-01-01',
      bloodGroup: 'O+',
      guardianContact: '1234567890',
      address: 'Example Address',
      studentImage: 'Base64 image string here'
    }];

    // Create workbook and worksheet
    const wb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(templateData);

    // Add worksheet to workbook
    xlsx.utils.book_append_sheet(wb, ws, 'Template');

    // Generate Excel file
    const excelBuffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

    // Set response headers
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=import-template.xlsx');

    // Send the file
    res.send(Buffer.from(excelBuffer));

  } catch (error) {
    console.error('Error generating template:', error);
    res.status(500).json({ 
      message: 'Failed to generate import template', 
      error: error.message 
    });
  }
});

// Test Route
app.get('/', (req, res) => {
  res.send('Server is running');
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    message: 'Something went wrong!', 
    error: err.message 
  });
});

// Start the server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});