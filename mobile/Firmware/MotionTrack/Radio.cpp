#include "BuildMode.h"
#if !MOTIONTRACK_WEBSITE
#include "Radio.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLE2902.h>
#include <atomic>
namespace radio {
namespace {
BLEServer* server;
BLECharacteristic* output;
QueueHandle_t commands;
std::atomic<bool> reconnect{false}, connected{false};
workout::Packet last{};
uint32_t publishedAt = 0;
class Links : public BLEServerCallbacks {
    void onConnect(BLEServer*) override { connected.store(true); }
    void onDisconnect(BLEServer*) override { connected.store(false); reconnect.store(true); }
} links;
class Writes : public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic* input) override {
        workout::Command c{};
        if (workout::decode(input->getData(),input->getLength(),c))
            xQueueSend(commands,&c,0);
    }
} writes;
}
void begin() {
    commands = xQueueCreate(8,sizeof(workout::Command));
    configASSERT(commands);
    BLEDevice::init("Motion Log");
    server=BLEDevice::createServer();
    server->setCallbacks(&links);
    auto* svc=server->createService(workout::service);
    output=svc->createCharacteristic(workout::telemetry,BLECharacteristic::PROPERTY_READ|BLECharacteristic::PROPERTY_NOTIFY);
    output->addDescriptor(new BLE2902());
    auto* input=svc->createCharacteristic(workout::control,BLECharacteristic::PROPERTY_WRITE);
    input->setCallbacks(&writes);
    publish(workout::packet(workout::Starting,0,0,0,0,0,0,0,0));
    svc->start();
    BLEAdvertisementData adv,scan;
    adv.setFlags(0x06);
    adv.setCompleteServices(BLEUUID(workout::service));
    scan.setName("Motion Log");
    auto* ad=BLEDevice::getAdvertising();
    ad->setAdvertisementData(adv);
    ad->setScanResponseData(scan);
    ad->setScanResponse(true);
    ad->start();
}
// Both are safe to call before begin() (for example from a startup fault).
bool next(workout::Command& cmd) {return commands && xQueueReceive(commands,&cmd,0)==pdTRUE;}
void publish(const workout::Packet& value) {
    if (!server || !output) return;
    if (reconnect.exchange(false) && !connected.load()) server->startAdvertising();
    if (value == last && millis()-publishedAt < 1000) return;
    last=value;
    publishedAt=millis();
    output->setValue(last.data(),last.size());
    if (connected.load()) output->notify();
}
}
#endif
