import { motion } from 'framer-motion';
import logo from '../../assets/roña.png';
import { HowToPlayButton } from './HowToPlay';
import { MusicToggle } from './music';
import { FriendsButton } from '../account/FriendsPanel';

// Barra superior del lobby y la sala: logo, un título opcional y botones
export const TopBar = ({ title, subtitle, children }) => (
  <motion.header
    className="topbar"
    initial={{ y: -80, opacity: 0 }}
    animate={{ y: 0, opacity: 1 }}
    transition={{ type: 'spring', stiffness: 260, damping: 24 }}
  >
    <motion.img
      src={logo}
      alt="Roña"
      className="topbar__logo"
      whileHover={{ rotate: [0, -6, 6, 0], scale: 1.06 }}
      transition={{ duration: 0.5 }}
    />
    {title && (
      <div className="topbar__title">
        {subtitle && <span className="topbar__subtitle">{subtitle}</span>}
        <h1>{title}</h1>
      </div>
    )}
    <div className="topbar__actions">
      {children}
      <FriendsButton />
      <HowToPlayButton compact />
      <MusicToggle />
    </div>
  </motion.header>
);
