import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

export const generateToken = (user) => {
  return jwt.sign(
    { id: user.id, role: user.role, branch_id: user.branch_id },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
};

export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};
