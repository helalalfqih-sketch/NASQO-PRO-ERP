import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  SystemChrome.setSystemUIOverlayStyle(const SystemUiOverlayStyle(
    statusBarColor: Color(0xFF312E81),
    statusBarIconBrightness: Brightness.light,
    systemNavigationBarColor: Color(0xFF312E81),
    systemNavigationBarIconBrightness: Brightness.light,
  ));
  runApp(const MaterialApp(
    debugShowCheckedModeBanner: false,
    home: Scaffold(
      body: SafeArea(child: AndroidView(viewType: 'nasqo/original_web')),
    ),
  ));
}
