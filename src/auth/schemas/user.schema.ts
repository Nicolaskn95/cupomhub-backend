import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { HydratedDocument } from 'mongoose'

export type UserDocument = HydratedDocument<User>

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true, lowercase: true })
  username: string

  @Prop({ required: false, select: false })
  passwordHash?: string

  @Prop({ required: false, unique: true, sparse: true })
  googleId?: string

  @Prop({ required: false, trim: true, lowercase: true, unique: true, sparse: true })
  email?: string

  @Prop({ required: false })
  avatarUrl?: string
}

export const UserSchema = SchemaFactory.createForClass(User)
