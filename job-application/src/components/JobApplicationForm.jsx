import React, { useState } from 'react';
import { storage } from '../services/firebase'; // ✅ Correct Import
import { ref, uploadBytes } from 'firebase/storage';

function JobApplicationForm() {
  const [formData, setFormData] = useState({ name: '', email: '', phone: '' });
  const [file, setFile] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) return alert("Please upload a CV");

    const cvRef = ref(storage, `cvs/${file.name}`); // ✅ Upload to Firebase Storage
    await uploadBytes(cvRef, file);

    const response = await fetch('https://your-firebase-function-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...formData, cvFileName: file.name }),
    });

    if (response.ok) {
      alert('Application submitted successfully!');
    } else {
      alert('Error submitting application');
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="text" placeholder="Name" required onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
      <input type="email" placeholder="Email" required onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
      <input type="tel" placeholder="Phone" required onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
      <input type="file" accept=".pdf,.docx" required onChange={(e) => setFile(e.target.files[0])} />
      <button type="submit">Submit</button>
    </form>
  );
}

export default JobApplicationForm;
