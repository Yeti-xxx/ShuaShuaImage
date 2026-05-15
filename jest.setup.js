jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: {
    getPhotos: jest.fn(() => Promise.resolve({edges: []})),
    deletePhotos: jest.fn(() => Promise.resolve()),
  },
}));

jest.mock('react-native-linear-gradient', () => {
  const {View} = require('react-native');
  return {
    __esModule: true,
    default: View,
  };
});
