declare module 'react-native-video' {
  import {Component} from 'react';
  export default class Video extends Component<any, any> {
    seek: (time: number) => void;
  }
}
